import {inspectFile} from './inspect.js';
import {demuxNative,SMALL_FILE_PRELOAD_BYTES} from './native-demux.js';

// One speculative compressed-input buffer, never another video/audio decoder.
// The active native player's existing 256 MiB cache is separate from this 64 MiB
// allowance. Blob reads cannot be aborted, so canceled preparations stay in the
// serial slot until their physical read finishes before another may start.
export const NEXT_CLIP_PRELOAD_BYTES=SMALL_FILE_PRELOAD_BYTES;
export const NEXT_CLIP_LEAD_SECONDS=15;
// Constructing a Blob may copy its ArrayBuffer part; cap the temporary plus
// retained browser payload at the same 64 MiB allowance.
export const BROWSER_PRELOAD_PREFIX_BYTES=NEXT_CLIP_PRELOAD_BYTES/2;
const check=signal=>{if(signal?.aborted)throw new DOMException('Next clip preparation canceled.','AbortError');};
export function shouldPreloadNext({playing,buffering=false,preparing=false,currentTime,duration}){
 return playing&&!buffering&&!preparing&&Number.isFinite(currentTime)&&Number.isFinite(duration)&&duration>0&&currentTime>0&&duration-currentTime>0&&duration-currentTime<=NEXT_CLIP_LEAD_SECONDS;
}
export async function prepareNextClip(file,{signal,confirmed=false}={}){
 let movie=null;
 try{
  check(signal);const info=await inspectFile(file);check(signal);
  if(info.nativeCandidate){
   movie=await demuxNative(file);check(signal);
   await movie.prepare();check(signal);
   return {info,movie,close(){movie.close();}};
  }
  // Projection remains an explicit per-File decision. Do not stage payload for
  // unconfirmed browser clips, and never play a hidden video just to warm it.
  if(!confirmed||!info.videoTracks.length)return {info,close(){}};
  const end=Math.min(file.size,BROWSER_PRELOAD_PREFIX_BYTES);
  const bytes=await file.slice(0,end).arrayBuffer();check(signal);
  if(bytes.byteLength!==end)throw new Error('Truncated next-clip input.');
  // Blob parts preserve byte order and retain the rest as a local file slice;
  // only the bounded prefix is staged in memory, not the entire recording.
  return {info,blob:new Blob([bytes,file.slice(end)],{type:file.type||'video/mp4'}),close(){this.blob=null;}};
 }catch(error){movie?.close();throw error;}
}

export function createNextClipPreloader({prepare=prepareNextClip}={}){
 let wanted=null,running=null,ready=null,attempted=null,disposed=false;
 function discard(){ready?.value.close();ready=null;}
 function start(){
  if(disposed||running||!wanted||wanted.key===attempted)return;
  const request=wanted;attempted=request.key;
  const abort=new AbortController();running={request,abort};
  Promise.resolve().then(()=>prepare(request.file,{signal:abort.signal,confirmed:request.confirmed})).then(value=>{
   if(!value)return;
   if(disposed||abort.signal.aborted||wanted!==request)value.close();
   else ready={request,value};
  }).catch(()=>{/* Speculation must never interrupt the current clip. Normal open retries. */}).finally(()=>{running=null;start();});
 }
 function cancel(){wanted=null;attempted=null;running?.abort.abort();discard();}
 return {
  consider(key,file,{confirmed=false}={}){
   if(disposed)return;
   if(!key||!file){cancel();return;}
   if(wanted?.key===key)return;
   cancel();wanted={key,file,confirmed};start();
  },
  // Never wait at EOF: use only a fully prepared exact successor. Incomplete,
  // failed or canceled work falls back to the ordinary open path immediately.
  take(key,file){
   const value=ready?.request.key===key&&ready.request.file===file?ready.value:null;
   if(value)ready=null;
   cancel();return value;
  },
  cancel,
  close(){disposed=true;cancel();}
 };
}
