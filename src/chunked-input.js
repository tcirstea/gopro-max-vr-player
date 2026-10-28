// Shared compressed-input cache. The budget includes reads still in flight:
// Blob.arrayBuffer() cannot be aborted, even when a seek cancels its consumer.
export const LARGE_FILE_CHUNK_BYTES=64*1024*1024;
export const LARGE_FILE_CACHE_CHUNKS=4;
const MAX_SAMPLE_BYTES=32*1024*1024;
const aborted=()=>new DOMException('Local video read was canceled.','AbortError');

export function createChunkedInput(file,{chunkBytes=LARGE_FILE_CHUNK_BYTES,maxChunks=LARGE_FILE_CACHE_CHUNKS,maxConcurrentReads=2,tracks=[]}={}){
 if(!Number.isSafeInteger(file.size)||file.size<1||!Number.isSafeInteger(chunkBytes)||chunkBytes<1||!Number.isInteger(maxChunks)||maxChunks<4||!Number.isInteger(maxConcurrentReads)||maxConcurrentReads<1||maxConcurrentReads>2)throw new Error('Invalid local input buffer limits.');
 const budget=chunkBytes*maxChunks;
 if(!Number.isSafeInteger(budget))throw new Error('Invalid local input buffer budget.');
 const consumerCount=Math.max(2,tracks.length);
 if(consumerCount>8)throw new Error('Too many local media consumers.');
 const entries=new Map(),requests=new Map(),current=Array.from({length:consumerCount},()=>[]),ahead=Array.from({length:consumerCount},()=>[]),hints=Array(consumerCount).fill(null);
 let generation=0,closed=false,prepared=false,scheduled=false,clock=0,reservedBytes=0,activeReads=0;
 const stats={readOperations:0,bytesRead:0,cacheHits:0,readMilliseconds:0,maxReadMilliseconds:0,prefetchReadOperations:0,prefetchHits:0,canceledReads:0,discardedReads:0,maxReservedBytes:0,maxActiveReads:0,sampleBytesCopied:0};
 const keysFor=sample=>{
  const first=Math.floor(sample.offset/chunkBytes),last=Math.floor((sample.offset+sample.size-1)/chunkBytes);
  return Array.from({length:last-first+1},(_,i)=>first+i);
 };
 const wanted=key=>ahead.some(keys=>keys.includes(key));
 const protectedKey=key=>current.some(keys=>keys.includes(key));
 function entryFor(key){
  let entry=entries.get(key);
  if(!entry){const start=key*chunkBytes;entry={key,start,end:Math.min(file.size,start+chunkBytes),state:'queued',refs:0,lastUse:++clock,data:null,generation};entries.set(key,entry);}
  return entry;
 }
 function releaseRequest(request,error,data){
  if(requests.get(request.trackIndex)!==request)return;
  requests.delete(request.trackIndex);request.entries.forEach(entry=>entry.refs--);
  if(error)request.reject(error);else request.resolve(data);
 }
 function finishRequests(){
  for(const request of requests.values()){
   const failed=request.entries.find(entry=>entry.state==='error');
   if(failed){releaseRequest(request,failed.error);continue;}
   if(!request.entries.every(entry=>entry.state==='ready'))continue;
   // Return an exact sample-owned buffer: a tiny sample must not keep an
   // evicted 64 MiB cache chunk alive while WebCodecs copies its input.
   try{
    const data=new Uint8Array(request.sample.size);let copied=0;
    for(const entry of request.entries){const start=Math.max(request.sample.offset,entry.start),end=Math.min(request.sample.offset+request.sample.size,entry.end);data.set(new Uint8Array(entry.data,start-entry.start,end-start),copied);copied+=end-start;entry.lastUse=++clock;}
    stats.sampleBytesCopied+=data.byteLength;prepared=true;releaseRequest(request,null,data);
   }catch(error){releaseRequest(request,error);}
  }
 }
 function makeRoom(entry,demand){
  const size=entry.end-entry.start;
  while(reservedBytes+size>budget){
   // Speculation cannot evict either track's current or desired next chunk.
   const ready=[...entries.values()].filter(other=>other.state==='ready'&&!other.refs);
   let victim=ready.filter(other=>!protectedKey(other.key)&&(demand||!wanted(other.key))).sort((a,b)=>a.lastUse-b.lastUse)[0];
   // Audio can occupy a third distant region. Previously-used current keys
   // are only a preference: active requests retain refs and are never evicted.
   // Demands may replace inactive old-current chunks to avoid a full-cache deadlock.
   if(!victim&&demand)victim=ready.sort((a,b)=>a.lastUse-b.lastUse)[0];
   if(!victim)return false;
   entries.delete(victim.key);reservedBytes-=victim.end-victim.start;victim.data=null;
  }
  return true;
 }
 function queueDrain(){if(!scheduled&&!closed){scheduled=true;queueMicrotask(drain);}}
 function startRead(entry){
  entry.state='loading';entry.speculative=!entry.refs;
  const bytes=entry.end-entry.start;reservedBytes+=bytes;activeReads++;
  stats.readOperations++;if(entry.speculative)stats.prefetchReadOperations++;
  stats.maxReservedBytes=Math.max(stats.maxReservedBytes,reservedBytes);stats.maxActiveReads=Math.max(stats.maxActiveReads,activeReads);
  const start=performance.now();
  // Attach both handlers immediately, including for speculative reads. A
  // speculative error is reported only if that chunk is actually demanded.
  Promise.resolve().then(()=>file.slice(entry.start,entry.end).arrayBuffer()).then(data=>settled(data,null),error=>settled(null,error));
  function settled(data,error){
   activeReads--;const elapsed=performance.now()-start;stats.readMilliseconds+=elapsed;stats.maxReadMilliseconds=Math.max(stats.maxReadMilliseconds,elapsed);stats.bytesRead+=data?.byteLength||0;
   if(closed||entry.generation!==generation||entries.get(entry.key)!==entry){reservedBytes-=bytes;stats.discardedReads++;queueDrain();return;}
   if(!error&&data?.byteLength!==bytes)error=new Error('Truncated video input chunk.');
   if(error){reservedBytes-=bytes;entry.state='error';entry.error=error;}
   else{entry.state='ready';entry.data=data;entry.lastUse=++clock;}
   queueDrain();
  }
 }
 function drain(){
  scheduled=false;if(closed)return;
  finishRequests();
  // Bound queued work as well as allocations. Only declared consumers and their
  // next sample-table transitions can request background work.
  for(const [key,entry] of entries){if(!entry.refs&&!wanted(key)&&(entry.state==='queued'||entry.state==='error'))entries.delete(key);}
  for(const keys of ahead)for(const key of keys)entryFor(key);
  while(activeReads<maxConcurrentReads){
   const queued=[...entries.values()].filter(entry=>entry.state==='queued'&&(entry.refs||wanted(entry.key))).sort((a,b)=>Number(Boolean(b.refs))-Number(Boolean(a.refs))||a.lastUse-b.lastUse);
   let started=false;
   for(const entry of queued){if(makeRoom(entry,Boolean(entry.refs))){startRead(entry);started=true;break;}}
   if(!started)break;
  }
 }
 function updateAhead(sample,trackIndex,sampleIndex,keys){
  const samples=tracks[trackIndex]?.samples;
  if(!samples){const next=keys.at(-1)+1;ahead[trackIndex]=next*chunkBytes<file.size?[next]:[];return;}
  const previous=hints[trackIndex],signature=keys.join(',');
  if(previous&&previous.signature===signature&&sampleIndex>=previous.index&&sampleIndex<previous.nextIndex){ahead[trackIndex]=previous.keys;return;}
  let index=sampleIndex+1,next=[];
  for(;index<samples.length;index++){next=keysFor(samples[index]).filter(key=>!keys.includes(key));if(next.length)break;}
  ahead[trackIndex]=next;hints[trackIndex]={signature,index:sampleIndex,nextIndex:index,keys:next};
 }
 function reset(){
  generation++;
  for(const request of [...requests.values()]){stats.canceledReads++;releaseRequest(request,aborted());}
  current.forEach(keys=>keys.length=0);ahead.forEach(keys=>keys.length=0);hints.fill(null);
  for(const [key,entry] of entries){
   if(entry.state==='ready'&&!closed)entry.generation=generation;
   else{entries.delete(key);if(entry.state==='ready'){reservedBytes-=entry.end-entry.start;entry.data=null;}}
  }
  // Loading entries removed above still own their reservations until settled.
 }
 return {
  read(sample,trackIndex=0,sampleIndex=0){
   if(closed)return Promise.reject(new Error('Local video input is closed.'));
   const {offset,size}=sample;
   if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(size)||offset<0||size<=0||size>MAX_SAMPLE_BYTES||!Number.isSafeInteger(offset+size)||offset+size>file.size)return Promise.reject(new Error('Sample points outside the local file or exceeds the safety limit.'));
   if(!Number.isInteger(trackIndex)||trackIndex<0||trackIndex>=consumerCount)return Promise.reject(new Error('Invalid video track index.'));
   if(requests.has(trackIndex))return Promise.reject(new Error('A video track already has a pending sample read.'));
   const keys=keysFor(sample);
   if(keys.length>2)return Promise.reject(new Error('Sample exceeds the chunk buffer safety limit.'));
   current[trackIndex]=keys;
   const needed=keys.map(entryFor);needed.forEach(entry=>{entry.refs++;entry.lastUse=++clock;});
   if(needed.every(entry=>entry.state==='ready'))stats.cacheHits++;
   if(needed.some(entry=>entry.speculative&&(entry.state==='ready'||entry.state==='loading')))stats.prefetchHits++;
   updateAhead(sample,trackIndex,sampleIndex,keys);
   const result=new Promise((resolve,reject)=>requests.set(trackIndex,{sample,trackIndex,entries:needed,resolve,reject}));
   queueDrain();return result;
  },
  reset,
  close(){if(closed)return;closed=true;reset();},
  getDiagnostics(){return {...stats,cachedBytes:[...entries.values()].reduce((sum,entry)=>sum+(entry.data?.byteLength||0),0),reservedBytes,activeReads,readAheadBytes:chunkBytes,cacheLimitBytes:budget,maxConcurrentReads};},
  getInputState(){return {strategy:'chunked-prefetch',preparing:!prepared&&!closed,chunkBytes,cacheLimitBytes:budget,maxConcurrentReads};}
 };
}
