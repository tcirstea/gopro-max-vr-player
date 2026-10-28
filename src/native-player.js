import {demuxNative} from './native-demux.js';
// A codec can retain inputs internally after decodeQueueSize reaches zero. Do not
// confuse these with queued decode requests, or a small output budget deadlocks it.
const OUTPUT_BUFFER=6, MAX_IN_FLIGHT=24, DECODE_QUEUE=4, START_BUFFER=3;
export async function createNativePlayer(file,{onFrames,onState=()=>{},onError=()=>{}}){
 if(!globalThis.isSecureContext||!globalThis.VideoDecoder)throw new Error('Native MAX playback needs WebCodecs in a secure context (HTTPS or localhost).');
 const movie=await demuxNative(file);
 const configs=movie.tracks.map(t=>({...t.config,hardwareAcceleration:'prefer-hardware',optimizeForLatency:true}));
 for(const config of configs){const result=await VideoDecoder.isConfigSupported(config);if(!result.supported)throw new Error(`This device cannot decode ${config.codec} at ${config.codedWidth} × ${config.codedHeight} through WebCodecs. Try a browser/OS with hardware HEVC support.`);}
 let generation=0,closed=false,playing=false,buffering=false,currentTime=0,target=0,mediaClock=0,lastTick=null,streams=[],shown=[],shownEnd=0,raf=0,failed=false;
 const stats={presentedPairs:0,droppedPairs:0,unpairedFrames:0,bufferingEvents:0,seeks:0,uploadMilliseconds:0,maxUploadMilliseconds:0};
 const notify=()=>onState({playing,buffering,currentTime,duration:movie.duration});
 const dispose=()=>{for(const s of streams){if(s.decoder.state!=='closed')s.decoder.close();s.frames.forEach(f=>f.close());}streams=[];};
 function fail(error){if(closed||failed)return;failed=true;playing=false;buffering=false;notify();onError(error);dispose();}
 function pump(s,g){
  if(s.reading||closed||failed||g!==generation)return;
  s.reading=true;
  (async()=>{try{
   while(g===generation&&!closed&&!failed&&s.index<s.track.samples.length&&s.frames.length<OUTPUT_BUFFER&&s.pending+s.frames.length<MAX_IN_FLIGHT&&(s.decoder.decodeQueueSize||0)<DECODE_QUEUE){
    const sample=s.track.samples[s.index++];const data=await movie.read(sample);if(g!==generation||closed||failed)return;
    s.pending++;s.submitted++;s.maxInFlight=Math.max(s.maxInFlight,s.pending+s.frames.length);
    s.decoder.decode(new EncodedVideoChunk({type:sample.key?'key':'delta',timestamp:sample.timestamp,duration:sample.duration,data}));
   }
   if(s.index===s.track.samples.length&&!s.flushed&&g===generation&&!closed&&!failed){s.flushed=true;await s.decoder.flush();if(g===generation)s.done=true;}
  }catch(error){if(g===generation)fail(error);}finally{s.reading=false;}})();
 }
 function seek(seconds){
  if(closed)return;generation++;dispose();failed=false;stats.seeks++;target=Math.max(0,Math.min(movie.duration-0.000001,Number(seconds)||0));currentTime=mediaClock=target;lastTick=null;buffering=playing;shownEnd=target;
  shown.forEach(f=>f.close());shown=[];
  const g=generation;
  try { for(const [trackIndex,track] of movie.tracks.entries()){
   let index=0;for(let i=0;i<track.samples.length;i++){if(track.samples[i].timestamp/1e6>target)break;if(track.samples[i].key)index=i;}
   const s={track,index,pending:0,frames:[],reading:false,flushed:false,done:false,submitted:0,decoded:0,maxInFlight:0};
   s.decoder=new VideoDecoder({output(frame){if(g!==generation||closed||failed){frame.close();return;}s.pending=Math.max(0,s.pending-1);s.decoded++;if((frame.timestamp+(frame.duration||33367))/1e6<=target){frame.close();}else{s.frames.push(frame);}pump(s,g);},error(error){if(g===generation)fail(error);}});
   streams.push(s);s.decoder.configure(configs[trackIndex]);
   s.decoder.ondequeue=()=>pump(s,g);
  }} catch(error){fail(error);throw error;}
  streams.forEach(s=>pump(s,g));notify();
 }
 function setBuffering(value){if(buffering===value)return;buffering=value;if(value)stats.bufferingEvents++;notify();}
 function tick(now){
  if(closed)return;
  const elapsed=lastTick===null?0:Math.max(0,Math.min(.1,(now-lastTick)/1000));lastTick=now;
  if(!failed&&streams.length===2){
   const [a,b]=streams.map(s=>s.frames);
   // Discard unmatched moments; never combine different timestamps.
   while(a.length&&b.length&&Math.abs(a[0].timestamp-b[0].timestamp)>2){(a[0].timestamp<b[0].timestamp?a:b).shift().close();stats.unpairedFrames++;}
   let resumed=false;
   if(playing&&buffering&&streams.every(s=>s.frames.length>=START_BUFFER||s.done)){setBuffering(false);resumed=true;}
   let desired=playing?mediaClock+(buffering||resumed?0:elapsed):target;
   // Freeze at the end of available paired media, not the wall clock. A slow
   // decoder must never cause a seek-like rush through frames or a false EOF.
   const end=f=>(f.timestamp+(f.duration||33367))/1e6;
   const bufferedEnd=a.length&&b.length?Math.min(end(a.at(-1)),end(b.at(-1)),movie.duration):shownEnd;
   if(playing)desired=Math.min(desired,Math.max(mediaClock,bufferedEnd));
   let next=null;
   while(a.length&&b.length){
    if(Math.abs(a[0].timestamp-b[0].timestamp)>2){(a[0].timestamp<b[0].timestamp?a:b).shift().close();stats.unpairedFrames++;continue;}
    if(a[0].timestamp/1e6>desired+.002)break;
    if(next){next.forEach(f=>f.close());stats.droppedPairs++;}
    next=[a.shift(),b.shift()];
   }
   // At most one GPU upload per animation frame, even after an interrupted tab.
   if(next){try{const start=performance.now();onFrames(...next);const cost=performance.now()-start;stats.uploadMilliseconds+=cost;stats.maxUploadMilliseconds=Math.max(stats.maxUploadMilliseconds,cost);shown.forEach(f=>f.close());shown=next;shownEnd=Math.min(...next.map(end),movie.duration);currentTime=next[0].timestamp/1e6;stats.presentedPairs++;notify();}catch(error){next.forEach(f=>f.close());fail(error);}}
   mediaClock=desired;
   if(playing&&!failed){
    if(shownEnd>=movie.duration-.000002&&mediaClock>=movie.duration-.000002){playing=false;buffering=false;currentTime=movie.duration;notify();}
    else if(mediaClock>=bufferedEnd-.000002)setBuffering(true);
   }
   streams.forEach(s=>pump(s,generation));
  }
  raf=requestAnimationFrame(tick);
 }
 try{seek(0);}catch(error){closed=true;dispose();throw error;}raf=requestAnimationFrame(tick);
 return {duration:movie.duration,get playing(){return playing;},play(){if(closed||failed)return;if(currentTime>=movie.duration)seek(0);mediaClock=Math.max(target,currentTime);lastTick=null;playing=true;setBuffering(true);notify();},pause(){playing=false;buffering=false;target=currentTime;mediaClock=currentTime;lastTick=null;notify();},seek,
 getDiagnostics(){return {version:2,limits:{outputFrames:OUTPUT_BUFFER,inFlight:MAX_IN_FLIGHT,decodeQueue:DECODE_QUEUE,startFrames:START_BUFFER},state:{playing,buffering,failed,currentTime,mediaClock,duration:movie.duration},counters:{...stats},tracks:streams.map(s=>({codec:s.track.config.codec,width:s.track.config.codedWidth,height:s.track.config.codedHeight,hardwareAcceleration:'prefer-hardware',submitted:s.submitted,decoded:s.decoded,pending:s.pending,queued:s.decoder.decodeQueueSize||0,bufferedFrames:s.frames.length,maxInFlight:s.maxInFlight,done:s.done}))};},
 close(){closed=true;generation++;cancelAnimationFrame(raf);dispose();shown.forEach(f=>f.close());shown=[];}};
}
