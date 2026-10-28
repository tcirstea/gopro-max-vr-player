import {createSpatialAudio} from './spatial-audio.js';
const DECODE_AHEAD=1, MAX_PENDING=24, SCHEDULE_AHEAD=.15, START_DELAY=.02;
export function pcm32ToPlanes(bytes,channels,frames){
 if(bytes.byteLength!==channels*frames*4)throw new Error('Truncated PCM audio.');
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),planes=Array.from({length:channels},()=>new Float32Array(frames));
 for(let i=0;i<frames;i++)for(let c=0;c<channels;c++)planes[c][i]=v.getInt32((i*channels+c)*4,true)/2147483648;
 return planes;
}
export async function createNativeAudio(movie,{onChange=()=>{}}={}){
 const Context=globalThis.AudioContext||globalThis.webkitAudioContext;
 let tracks=[];
 if(Context)for(const track of movie.audioTracks||[]){
  if(track.kind==='pcm-s32le')tracks.push(track);
  else if(globalThis.AudioDecoder&&globalThis.EncodedAudioChunk){try{if((await AudioDecoder.isConfigSupported(track.config)).supported)tracks.push(track);}catch{/* Unsupported AAC does not prevent video or spatial PCM. */}}
 }
 let selected=tracks.find(t=>t.mode==='stereo')||tracks.find(t=>t.mode==='mono')||tracks[0],context=null,gain=null,spatial=null,decoder=null,closed=false,failed=false,generation=0,reading=false,index=0,pending=0,done=false,queue=[],time=0,muted=true,rotation=null;
 let anchor=null,scheduledEnd=0;const sources=new Set();
 const stats={decodedPackets:0,scheduledBuffers:0,underruns:0,maxQueuedBuffers:0,maxPending:0};
 const state=()=>({available:!!selected&&!failed&&!closed,mode:selected?.mode||'unavailable',modes:tracks.map(t=>t.mode),muted,contextState:context?.state||'not-started',failed,spatialMetadata:selected?.spatial?{order:1,ordering:'ACN',normalization:'SN3D'}:null});
 function stop(){for(const s of sources){try{s.stop();}catch{}s.disconnect();}sources.clear();anchor=null;scheduledEnd=time;}
 function closeDecoder(){if(decoder&&decoder.state!=='closed')decoder.close();decoder=null;}
 function fail(){if(closed||failed)return;failed=true;stop();closeDecoder();queue=[];pending=0;onChange();}
 function ensureContext(){
  if(context)return;
  context=new Context({latencyHint:'interactive',sampleRate:selected.sampleRate});gain=context.createGain();gain.gain.value=muted?0:1;gain.connect(context.destination);
  if(selected.mode==='ambisonic'){spatial=createSpatialAudio(context,gain);if(rotation)spatial.setViewRotation(rotation);}
 }
 function push(planes,start,sampleRate){
  if(!planes.length||!planes[0].length)return;
  const end=start+planes[0].length/sampleRate;if(end<=time+.000001)return;
  const buffer=context.createBuffer(planes.length,planes[0].length,sampleRate);planes.forEach((p,c)=>buffer.copyToChannel(p,c));queue.push({buffer,start,end});stats.decodedPackets++;stats.maxQueuedBuffers=Math.max(stats.maxQueuedBuffers,queue.length);
 }
 function configure(g){
  if(selected.kind!=='aac')return;
  decoder=new AudioDecoder({output(data){
   if(g!==generation||closed||failed){data.close();return;}pending=Math.max(0,pending-1);
   try{if(data.numberOfChannels!==selected.channels||data.sampleRate!==selected.sampleRate)throw new Error('Unexpected decoded audio format.');const planes=Array.from({length:data.numberOfChannels},(_,c)=>{const p=new Float32Array(data.numberOfFrames);data.copyTo(p,{planeIndex:c,format:'f32-planar'});return p;});push(planes,data.timestamp/1e6,data.sampleRate);}catch{fail();}finally{data.close();}pump(g);
  },error(){if(g===generation)fail();}});decoder.configure(selected.config);decoder.ondequeue=()=>pump(g);
 }
 function pump(g=generation){
  if(reading||closed||failed||!selected||!context||g!==generation)return;
  reading=true;
  (async()=>{try{
   while(g===generation&&!closed&&!failed&&index<selected.samples.length&&pending<MAX_PENDING&&queue.length+pending<64&&(queue.at(-1)?.end??time)<time+DECODE_AHEAD&&(decoder?.decodeQueueSize||0)<8){
    const packetIndex=index++,sample=selected.samples[packetIndex],track=selected;
    const bytes=await movie.read(sample,track.inputIndex,packetIndex);if(g!==generation||closed||failed)return;
    if(track.kind==='aac'){pending++;stats.maxPending=Math.max(stats.maxPending,pending);decoder.decode(new EncodedAudioChunk({type:'key',timestamp:sample.timestamp,duration:sample.duration,data:bytes}));}
    else push(pcm32ToPlanes(bytes,track.channels,sample.frames),sample.timestamp/1e6,track.sampleRate);
   }
   if(index===selected.samples.length&&!done&&g===generation&&!closed&&!failed){if(decoder)await decoder.flush();if(g===generation)done=true;}
  }catch{if(g===generation)fail();}finally{if(g===generation)reading=false;}})();
 }
 function seek(seconds){
  if(closed)return;generation++;stop();closeDecoder();queue=[];pending=0;reading=false;done=false;time=seconds;scheduledEnd=seconds;
  if(!selected||failed)return;
  let low=0,high=selected.samples.length;while(low<high){const mid=(low+high)>>1;if((selected.samples[mid].timestamp+selected.samples[mid].duration)/1e6<=time)low=mid+1;else high=mid;}index=Math.max(0,low-(selected.kind==='aac'?2:0));
  if(context){try{configure(generation);pump();}catch{fail();}}
 }
 function readyEnd(at=time){
  if(!selected||failed)return movie.duration;
  if(at>=selected.duration-.000002)return movie.duration; // Preserve the full video when its audio track is shorter.
  let end=at;
  const firstStart=Math.max(0,selected.samples[0]?.timestamp/1e6||0);if(end<firstStart)end=firstStart;
  for(const item of queue){if(item.end<=end+.000002)continue;if(item.start>end+.000025)break;end=item.end;}
  if(done&&end>=selected.duration-.000025)return movie.duration;
  return Math.min(end,movie.duration);
 }
 function clock(){if(!anchor)return time;return Math.min(scheduledEnd,anchor.media+Math.max(0,context.currentTime-anchor.context));}
 function pause(at=clock()){time=at;stop();return time;}
 function schedule(at,videoEnd){
  if(closed)return;
  time=at;
  while(queue.length&&queue[0].end<=time+.000001)queue.shift();pump();
  if(!selected||failed||!context||context.state!=='running')return;
  const limit=Math.min(videoEnd,readyEnd(time),time+SCHEDULE_AHEAD,movie.duration);
  if(limit<=time+.000001)return;
  // If a throttled/background tab drained the scheduled horizon, re-anchor at
  // its exact end rather than racing to wall time or replaying past audio.
  if(!anchor||context.currentTime>anchor.context+(scheduledEnd-anchor.media)+.0001){if(anchor)stats.underruns++;stop();anchor={media:time,context:context.currentTime+START_DELAY};scheduledEnd=time;}
  let cursor=scheduledEnd;
  for(const item of queue){
   const start=Math.max(cursor,item.start),end=Math.min(limit,item.end,selected.duration);if(end<=start)continue;
   const source=context.createBufferSource();source.buffer=item.buffer;source.connect(spatial?.input||gain);sources.add(source);
   source.onended=()=>{source.disconnect();sources.delete(source);};
   source.start(anchor.context+start-anchor.media,start-item.start,end-start);stats.scheduledBuffers++;cursor=end;
   if(cursor>=limit-.000001)break;
  }
  // Audio-free head/tail intervals are real timeline silence, not stalls.
  if(cursor>=selected.duration-.000025||time<Math.max(0,selected.samples[0]?.timestamp/1e6||0))cursor=limit;
  scheduledEnd=Math.max(scheduledEnd,cursor);
 }
 return {
  get available(){return !!selected&&!failed&&!closed;},get state(){return state();},get ready(){return !!context&&context.state==='running';},
  async unlock(){if(!selected||failed||closed)return;try{ensureContext();if(!decoder&&!queue.length&&!done){configure(generation);pump();}}catch(error){fail();throw new Error(`Audio could not start: ${error.message}`);}try{await context.resume();if(!closed)onChange();}catch(error){throw new Error(`Audio could not start: ${error.message}`);}},
  seek,readyEnd,clock,schedule,pause,
  setMuted(value){muted=!!value;if(gain)gain.gain.setValueAtTime(muted?0:1,context.currentTime);onChange();},
  setViewRotation(value){rotation=value;spatial?.setViewRotation(value);},
  select(mode,at){const next=tracks.find(t=>t.mode===mode);if(!next||closed)return false;stop();spatial?.close();spatial=null;selected=next;failed=false;try{if(context&&selected.mode==='ambisonic'){spatial=createSpatialAudio(context,gain);if(rotation)spatial.setViewRotation(rotation);}seek(at);}catch{fail();return false;}onChange();return !failed;},
  getDiagnostics(){return {...state(),sampleRate:selected?.sampleRate||null,channels:selected?.channels||null,queuedBuffers:queue.length,pending,scheduledEnd,clock:clock(),done,...stats};},
  close(){if(closed)return;closed=true;generation++;stop();closeDecoder();queue=[];spatial?.close();gain?.disconnect();if(context)context.close().catch(()=>{});}
 };
}
