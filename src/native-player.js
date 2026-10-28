import {demuxNative} from './native-demux.js';
const BUFFER=8;
// VideoFrames stay owned here until replaced; renderer may retain the current pair.
export async function createNativePlayer(file,{onFrames,onState=()=>{},onError=()=>{}}){
 if(!globalThis.isSecureContext||!globalThis.VideoDecoder)throw new Error('Native MAX playback needs WebCodecs in a secure context (HTTPS or localhost).');
 const movie=await demuxNative(file);
 for(const t of movie.tracks){const result=await VideoDecoder.isConfigSupported({...t.config,optimizeForLatency:true});if(!result.supported)throw new Error(`This device cannot decode ${t.config.codec} at ${t.config.codedWidth} × ${t.config.codedHeight} through WebCodecs. Try a browser/OS with hardware HEVC support.`);}
 let generation=0,closed=false,playing=false,currentTime=0,target=0,anchor=0,streams=[],shown=[],raf=0,failed=false;
 const notify=()=>onState({playing,currentTime,duration:movie.duration});
 const dispose=()=>{for(const s of streams){if(s.decoder.state!=='closed')s.decoder.close();s.frames.forEach(f=>f.close());}streams=[];};
 function fail(error){if(closed||failed)return;failed=true;playing=false;notify();onError(error);dispose();}
 function pump(s,g){
  if(s.reading||closed||failed||g!==generation)return;
  s.reading=true;
  (async()=>{try{
   while(g===generation&&!closed&&!failed&&s.index<s.track.samples.length&&s.pending+s.frames.length<BUFFER){
    const sample=s.track.samples[s.index++];const data=await movie.read(sample);if(g!==generation||closed||failed)return;
    s.pending++;s.decoder.decode(new EncodedVideoChunk({type:sample.key?'key':'delta',timestamp:sample.timestamp,duration:sample.duration,data}));
   }
   if(s.index===s.track.samples.length&&!s.flushed&&g===generation&&!closed&&!failed){s.flushed=true;await s.decoder.flush();s.done=true;}
  }catch(error){if(g===generation)fail(error);}finally{s.reading=false;}})();
 }
 function seek(seconds){
  if(closed)return;generation++;dispose();failed=false;target=Math.max(0,Math.min(movie.duration-0.000001,Number(seconds)||0));currentTime=target;anchor=performance.now()-target*1000;
  const g=generation;
  try { for(const track of movie.tracks){
   let index=0;for(let i=0;i<track.samples.length;i++){if(track.samples[i].timestamp/1e6>target)break;if(track.samples[i].key)index=i;}
   const s={track,index,pending:0,frames:[],reading:false,flushed:false,done:false};
   s.decoder=new VideoDecoder({output(frame){if(g!==generation||closed||failed){frame.close();return;}s.pending=Math.max(0,s.pending-1);if((frame.timestamp+(frame.duration||33367))/1e6<=target){frame.close();}else{s.frames.push(frame);}pump(s,g);},error(error){if(g===generation)fail(error);}});
   streams.push(s);s.decoder.configure({...track.config,optimizeForLatency:true});
  }} catch(error){fail(error);throw error;}
  streams.forEach(s=>pump(s,g));notify();
 }
 function tick(now){
  if(closed)return;
  if(!failed&&streams.length===2){
   const desired=playing?(now-anchor)/1000:target;
   let a=streams[0].frames,b=streams[1].frames;
   // Pair presentation timestamps, never silently combine different moments.
   while(a.length&&b.length){
    if(Math.abs(a[0].timestamp-b[0].timestamp)>2){(a[0].timestamp<b[0].timestamp?a:b).shift().close();continue;}
    const timestamp=a[0].timestamp/1e6;
    if(timestamp>desired+0.002)break;
    const next=[a.shift(),b.shift()];try{onFrames(...next);}catch(error){next.forEach(f=>f.close());fail(error);break;}
    shown.forEach(f=>f.close());shown=next;currentTime=timestamp;notify();
   }
   streams.forEach(s=>pump(s,generation));
   if(playing&&desired>=movie.duration){playing=false;currentTime=movie.duration;notify();}
  }
  raf=requestAnimationFrame(tick);
 }
 try{seek(0);}catch(error){closed=true;dispose();throw error;}raf=requestAnimationFrame(tick);
 return {duration:movie.duration,get playing(){return playing;},play(){if(closed||failed)return;if(currentTime>=movie.duration)seek(0);anchor=performance.now()-currentTime*1000;playing=true;notify();},pause(){playing=false;target=currentTime;notify();},seek,close(){closed=true;generation++;cancelAnimationFrame(raf);dispose();shown.forEach(f=>f.close());shown=[];}};
}
