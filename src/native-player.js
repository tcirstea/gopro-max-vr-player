import {demuxNative} from './native-demux.js';
import {createNativeAudio} from './native-audio.js';
import {createMaxStabilization} from './max-stabilization.js';
// A codec can retain inputs internally after decodeQueueSize reaches zero. Do not
// confuse these with queued decode requests, or a small output budget deadlocks it.
const OUTPUT_BUFFER=6, MAX_IN_FLIGHT=24, DECODE_QUEUE=4, START_BUFFER=3;
export async function createNativePlayer(file,{onFrames,onState=()=>{},onError=()=>{},autoTick=true}){
 if(!globalThis.isSecureContext||!globalThis.VideoDecoder)throw new Error('Native MAX playback needs WebCodecs in a secure context (HTTPS or localhost).');
 const movie=await demuxNative(file);
 const configs=movie.tracks.map(t=>({...t.config,hardwareAcceleration:'prefer-hardware',optimizeForLatency:true}));
 try{for(const config of configs){const result=await VideoDecoder.isConfigSupported(config);if(!result.supported)throw new Error(`This device cannot decode ${config.codec} at ${config.codedWidth} × ${config.codedHeight} through WebCodecs. Try a browser/OS with hardware HEVC support.`);}}catch(error){movie.close();throw error;}
 let audio=null,stabilization=null,playRequest=0;const orientations=new Map();
 let generation=0,closed=false,playing=false,buffering=false,currentTime=0,target=0,mediaClock=0,lastTick=null,streams=[],shown=[],shownEnd=0,raf=0,failed=false;
 const stats={presentedPairs:0,droppedPairs:0,unpairedFrames:0,bufferingEvents:0,seeks:0,uploadMilliseconds:0,maxUploadMilliseconds:0,animationTicks:0,maxAnimationGapMilliseconds:0};
 const notify=()=>onState({playing,buffering,preparing:movie.getInputState().preparing,inputStrategy:movie.getInputState().strategy,currentTime,duration:movie.duration,audio:audio?.state});
 const dispose=()=>{for(const s of streams){if(s.decoder.state!=='closed')s.decoder.close();s.frames.forEach(f=>f.close());}streams=[];};
 function fail(error){if(closed||failed)return;failed=true;playing=false;buffering=false;dispose();audio?.close();stabilization?.close();orientations.clear();movie.close();notify();onError(error);}
 function pump(s,g){
  if(s.reading||closed||failed||g!==generation)return;
  s.reading=true;
  (async()=>{try{
   while(g===generation&&!closed&&!failed&&s.index<s.track.samples.length&&s.frames.length<OUTPUT_BUFFER&&s.pending+s.frames.length<MAX_IN_FLIGHT&&(s.decoder.decodeQueueSize||0)<DECODE_QUEUE){
    const sample=s.track.samples[s.index++];
    if(s.trackIndex===0){const rotation=await stabilization?.prepare(sample.timestamp);if(g!==generation||closed||failed)return;if(rotation)orientations.set(sample.timestamp,rotation);}
    const data=await movie.read(sample,s.trackIndex,s.index-1);if(g!==generation||closed||failed)return;
    s.pending++;s.submitted++;s.maxInFlight=Math.max(s.maxInFlight,s.pending+s.frames.length);
    s.submittedAt.set(sample.timestamp,performance.now());
    s.decoder.decode(new EncodedVideoChunk({type:sample.key?'key':'delta',timestamp:sample.timestamp,duration:sample.duration,data}));
   }
   if(s.index===s.track.samples.length&&!s.flushed&&g===generation&&!closed&&!failed){s.flushed=true;await s.decoder.flush();if(g===generation)s.done=true;}
  }catch(error){if(g===generation)fail(error);}finally{s.reading=false;}})();
 }
 function seek(seconds){
  if(closed||failed)return;playRequest++;generation++;dispose();orientations.clear();movie.reset();stats.seeks++;target=Math.max(0,Math.min(movie.duration-0.000001,Number(seconds)||0));currentTime=mediaClock=target;lastTick=null;buffering=playing;shownEnd=target;audio?.seek(target);
  shown.forEach(f=>f.close());shown=[];
  const g=generation;
  try { for(const [trackIndex,track] of movie.tracks.entries()){
   let index=0;for(let i=0;i<track.samples.length;i++){if(track.samples[i].timestamp/1e6>target)break;if(track.samples[i].key)index=i;}
   const s={track,trackIndex,index,pending:0,frames:[],reading:false,flushed:false,done:false,submitted:0,decoded:0,maxInFlight:0,submittedAt:new Map(),decodeMilliseconds:0,maxDecodeMilliseconds:0};
   s.decoder=new VideoDecoder({output(frame){if(g!==generation||closed||failed){frame.close();return;}s.pending=Math.max(0,s.pending-1);s.decoded++;const submittedAt=s.submittedAt.get(frame.timestamp);if(submittedAt!==undefined){const elapsed=performance.now()-submittedAt;s.decodeMilliseconds+=elapsed;s.maxDecodeMilliseconds=Math.max(s.maxDecodeMilliseconds,elapsed);s.submittedAt.delete(frame.timestamp);}if((frame.timestamp+(frame.duration||33367))/1e6<=target){frame.close();if(trackIndex===0)orientations.delete(frame.timestamp);}else{s.frames.push(frame);}pump(s,g);},error(error){if(g===generation)fail(error);}});
   streams.push(s);s.decoder.configure(configs[trackIndex]);
   s.decoder.ondequeue=()=>pump(s,g);
  }} catch(error){fail(error);throw error;}
  streams.forEach(s=>pump(s,g));notify();
 }
 function setBuffering(value){if(buffering===value)return;buffering=value;if(value){stats.bufferingEvents++;audio?.pause(mediaClock);}notify();}
 function tick(now){
  if(closed)return;
  if(playing&&lastTick!==null){stats.animationTicks++;stats.maxAnimationGapMilliseconds=Math.max(stats.maxAnimationGapMilliseconds,now-lastTick);}
  const elapsed=lastTick===null?0:Math.max(0,Math.min(.1,(now-lastTick)/1000));lastTick=now;
  if(!failed&&streams.length===2){
   const [a,b]=streams.map(s=>s.frames);
   // Discard unmatched moments; never combine different timestamps.
   while(a.length&&b.length&&Math.abs(a[0].timestamp-b[0].timestamp)>2){const queue=a[0].timestamp<b[0].timestamp?a:b,frame=queue.shift();if(queue===a)orientations.delete(frame.timestamp);frame.close();stats.unpairedFrames++;}
   let resumed=false;
   // A suspended context retains its exact elapsed audio clock. Capture it
   // before pause() clears the anchor; the previous RAF mediaClock is stale.
   if(playing&&audio?.available&&!audio.ready){if(!buffering)mediaClock=audio.clock();setBuffering(true);}
   const audioEnd=audio?.available?audio.readyEnd(mediaClock):movie.duration;
   if(playing&&buffering&&streams.every(s=>s.frames.length>=START_BUFFER||s.done)&&(!audio?.available||(audio.ready&&audioEnd>=Math.min(movie.duration,mediaClock+.04)-.000002))){setBuffering(false);resumed=true;}
   let desired=playing?(buffering?mediaClock:audio?.available?audio.clock():mediaClock+(resumed?0:elapsed)):Math.max(target,currentTime);
   // Freeze at the end of available paired media, not the wall clock. A slow
   // decoder must never cause a seek-like rush through frames or a false EOF.
   const end=f=>(f.timestamp+(f.duration||33367))/1e6;
   const videoEnd=a.length&&b.length?Math.min(end(a.at(-1)),end(b.at(-1)),movie.duration):shownEnd;
   const bufferedEnd=Math.min(videoEnd,audioEnd);
   if(playing)desired=Math.min(desired,Math.max(mediaClock,bufferedEnd));
   let next=null;
   while(a.length&&b.length){
    if(Math.abs(a[0].timestamp-b[0].timestamp)>2){const queue=a[0].timestamp<b[0].timestamp?a:b,frame=queue.shift();if(queue===a)orientations.delete(frame.timestamp);frame.close();stats.unpairedFrames++;continue;}
    if(a[0].timestamp/1e6>desired+.002)break;
    if(next){orientations.delete(next[0].timestamp);next.forEach(f=>f.close());stats.droppedPairs++;}
    next=[a.shift(),b.shift()];
   }
   // At most one GPU upload per animation frame, even after an interrupted tab.
   if(next){try{const start=performance.now();onFrames(...next,{stabilization:orientations.get(next[0].timestamp)||null});orientations.delete(next[0].timestamp);const cost=performance.now()-start;stats.uploadMilliseconds+=cost;stats.maxUploadMilliseconds=Math.max(stats.maxUploadMilliseconds,cost);shown.forEach(f=>f.close());shown=next;shownEnd=Math.min(...next.map(end),movie.duration);currentTime=next[0].timestamp/1e6;stats.presentedPairs++;notify();}catch(error){next.forEach(f=>f.close());fail(error);}}
   mediaClock=desired;
   if(playing&&!failed){
    if(shownEnd>=movie.duration-.000002&&mediaClock>=movie.duration-.000002){playing=false;buffering=false;currentTime=movie.duration;audio?.pause(movie.duration);notify();}
    else if(mediaClock>=bufferedEnd-.000002)setBuffering(true);
    if(!buffering)audio?.schedule(mediaClock,videoEnd);
   }
   streams.forEach(s=>pump(s,generation));
  }
  if(autoTick)raf=requestAnimationFrame(tick);
 }
 stabilization=await createMaxStabilization(file,movie.tracks[0].samples);
 audio=await createNativeAudio(movie,{onChange:notify});
 try{seek(0);}catch(error){closed=true;dispose();audio?.close();stabilization?.close();movie.close();throw error;}if(autoTick)raf=requestAnimationFrame(tick);
 // The renderer can drive this from its active window/XR loop instead.
 return {advance:tick,duration:movie.duration,get playing(){return playing;},get audioState(){return audio.state;},play(){
  if(closed||failed||playing)return;
  const begin=()=>{if(currentTime>=movie.duration)seek(0);mediaClock=Math.max(target,currentTime);lastTick=null;playing=true;setBuffering(true);notify();};
  if(!audio.available){begin();return;}
  const request=++playRequest;return audio.unlock().then(()=>{if(request===playRequest&&!closed&&!failed)begin();});
 },pause(){playRequest++;if(audio.available&&!buffering)mediaClock=audio.clock();playing=false;buffering=false;target=currentTime=mediaClock;audio.pause(mediaClock);lastTick=null;notify();},seek,
 setMuted(value){audio.setMuted(value);},setViewRotation(value){audio.setViewRotation(value);},setAudioMode(mode){if(audio.select(mode,mediaClock))seek(mediaClock);},
 getDiagnostics(){return {version:6,audio:audio.getDiagnostics(),stabilization:stabilization.getDiagnostics(),inputState:movie.getInputState(),input:movie.getReadDiagnostics(),limits:{outputFrames:OUTPUT_BUFFER,inFlight:MAX_IN_FLIGHT,decodeQueue:DECODE_QUEUE,startFrames:START_BUFFER},state:{playing,buffering,failed,currentTime,mediaClock,duration:movie.duration},counters:{...stats},tracks:streams.map(s=>({codec:s.track.config.codec,width:s.track.config.codedWidth,height:s.track.config.codedHeight,hardwareAcceleration:'prefer-hardware',submitted:s.submitted,decoded:s.decoded,pending:s.pending,queued:s.decoder.decodeQueueSize||0,bufferedFrames:s.frames.length,maxInFlight:s.maxInFlight,decodeMilliseconds:s.decodeMilliseconds,maxDecodeMilliseconds:s.maxDecodeMilliseconds,done:s.done}))};},
 close(){closed=true;playRequest++;generation++;audio?.close();stabilization?.close();orientations.clear();cancelAnimationFrame(raf);dispose();movie.close();shown.forEach(f=>f.close());shown=[];}};
}
