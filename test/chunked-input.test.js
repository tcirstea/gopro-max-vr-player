import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createChunkedInput} from '../src/chunked-input.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const bytes=(offset,size)=>Uint8Array.from({length:size},(_,i)=>(offset+i)%251);
function source(size=256,{deferred=false,failAt=-1,truncateAt=-1}={}){
 const calls=[],pending=[];
 return {size,calls,pending,slice(start,end){
  assert.ok(start>=0&&end<=size&&end>start,'read stays inside file');
  calls.push([start,end]);
  return {arrayBuffer(){
   const produce=()=>{if(start===failAt)throw new Error('Synthetic storage failure');return bytes(start,end-start-(start===truncateAt?1:0)).buffer;};
   if(!deferred)return Promise.resolve().then(produce);
   return new Promise((resolve,reject)=>pending.push(()=>{try{resolve(produce());}catch(error){reject(error);}}));
  }};
 },finish(){const batch=pending.splice(0);batch.forEach(done=>done());}};
}
function bounded(input,chunkBytes=16,maxChunks=4){
 const d=input.getDiagnostics();
 assert.ok(d.cachedBytes<=maxChunks*chunkBytes);
 assert.ok(d.reservedBytes<=maxChunks*chunkBytes);
 assert.ok(d.maxReservedBytes<=maxChunks*chunkBytes);
 assert.ok(d.activeReads<=2);assert.ok(d.maxActiveReads<=2);
}

test('concurrent interleaved tracks deduplicate aligned windows and return independent sample bytes',async()=>{
 const file=source(),input=createChunkedInput(file,{chunkBytes:16});
 try{
  const [a,b]=await Promise.all([input.read({offset:3,size:4},0),input.read({offset:9,size:4},1)]);
  assert.deepEqual(a,bytes(3,4));assert.deepEqual(b,bytes(9,4));
  assert.equal(file.calls.filter(([start])=>start===0).length,1);
  assert.equal(a.buffer.byteLength,4,'sample must not pin an entire cached chunk');
  assert.equal(b.buffer.byteLength,4);
  a[0]=255;assert.deepEqual(await input.read({offset:3,size:4},0),bytes(3,4),'consumer mutation cannot corrupt cache');
  bounded(input);
 }finally{input.close();}
});

test('samples across chunk boundaries and EOF have exact bytes',async()=>{
 const file=source(53),input=createChunkedInput(file,{chunkBytes:16});
 try{
  for(const [offset,size] of [[13,8],[31,16],[48,5],[0,16]])assert.deepEqual(await input.read({offset,size},0),bytes(offset,size));
  assert.ok(file.calls.every(([start,end])=>start%16===0&&end-start<=16));
  bounded(input);
 }finally{input.close();}
});

test('distant tracks progress within the shared memory budget',async()=>{
 const file=source(2048),input=createChunkedInput(file,{chunkBytes:16});
 try{
  for(let step=0;step<20;step++){
   const offsets=[step*8,1024+step*8];
   const result=await Promise.all(offsets.map((offset,track)=>input.read({offset,size:8},track,step)));
   result.forEach((data,i)=>assert.deepEqual(data,bytes(offsets[i],8)));bounded(input);
  }
  assert.equal(file.calls.length,new Set(file.calls.map(([start])=>start)).size,'distant-track chunks are not reread through cache thrashing');
  assert.ok(file.calls.length<=22,'20 consumed chunks plus at most one lookahead per track');
 }finally{input.close();}
});

test('sample-table lookahead follows a distant next sample rather than sequential file bytes',async()=>{
 const file=source(1024),tracks=[{samples:[{offset:0,size:4},{offset:512,size:4}]} ,{samples:[{offset:4,size:4},{offset:516,size:4}]}];
 const input=createChunkedInput(file,{chunkBytes:16,tracks});
 try{
  await Promise.all([input.read(tracks[0].samples[0],0,0),input.read(tracks[1].samples[0],1,0)]);
  await tick();
  assert.ok(file.calls.some(([start])=>start===512),'next needed distant window prefetched before demand');
  const before=file.calls.filter(([start])=>start===512).length;
  await input.read(tracks[0].samples[1],0,1);
  assert.equal(file.calls.filter(([start])=>start===512).length,before);
  assert.ok(input.getDiagnostics().prefetchReadOperations>0);bounded(input);
 }finally{input.close();}
});

test('reset rejects pending consumers and keeps uncancelable read reservations until completion',{timeout:3000},async()=>{
 const file=source(2048,{deferred:true}),input=createChunkedInput(file,{chunkBytes:16});
 try{
  const old=[input.read({offset:0,size:4},0),input.read({offset:1024,size:4},1)];
  const outcomes=old.map(p=>p.then(()=>({resolved:true}),error=>error));
  await tick();assert.ok(input.getDiagnostics().activeReads>0);
  input.reset();
  for(const error of await Promise.all(outcomes))assert.equal(error.name,'AbortError');
  const reserved=input.getDiagnostics().reservedBytes;assert.ok(reserved>0,'physical reads remain budgeted');
  for(let i=0;i<12;i++){
   const pending=input.read({offset:128+i*16,size:4},0).then(()=>null,error=>error);
   input.reset();assert.equal((await pending).name,'AbortError');bounded(input);
  }
  let finished=false,result;
  const latest=input.read({offset:768,size:4},0).then(value=>{finished=true;result=value;});
  for(let i=0;i<12&&!finished;i++){file.finish();await tick();bounded(input);}
  await latest;assert.deepEqual(result,bytes(768,4));
  assert.ok(input.getDiagnostics().discardedReads>0);
 }finally{input.close();file.finish();await tick();}
});

test('close rejects pending reads, discards late results and refuses new consumers',{timeout:3000},async()=>{
 const file=source(256,{deferred:true}),input=createChunkedInput(file,{chunkBytes:16});
 const pending=input.read({offset:0,size:4},0).then(()=>null,error=>error);
 await tick();input.close();assert.equal((await pending).name,'AbortError');
 file.finish();await tick();
 assert.equal(input.getDiagnostics().cachedBytes,0);assert.equal(input.getDiagnostics().reservedBytes,0);
 await assert.rejects(input.read({offset:0,size:4},0));
});

test('invalid samples fail before launching storage reads',async()=>{
 const file=source(),input=createChunkedInput(file,{chunkBytes:16});
 try{
  for(const sample of [{offset:-1,size:1},{offset:255,size:2},{offset:0,size:0},{offset:NaN,size:1},{offset:0,size:33*1024*1024},{offset:Number.MAX_SAFE_INTEGER,size:1}])await assert.rejects(input.read(sample,0));
  assert.equal(file.calls.length,0);
 }finally{input.close();}
});

test('truncated foreground windows reject rather than returning partial samples',async()=>{
 const file=source(64,{truncateAt:0}),input=createChunkedInput(file,{chunkBytes:16});
 try{await assert.rejects(input.read({offset:0,size:4},0),/truncat/i);}finally{input.close();}
});

test('speculative storage failure is observed only when its window is demanded',async()=>{
 const file=source(128,{failAt:64}),tracks=[{samples:[{offset:0,size:4},{offset:64,size:4}]}];
 const input=createChunkedInput(file,{chunkBytes:16,tracks});
 try{
  assert.deepEqual(await input.read(tracks[0].samples[0],0,0),bytes(0,4));await tick();
  assert.ok(file.calls.some(([start])=>start===64));
  await assert.rejects(input.read(tracks[0].samples[1],0,1),/storage failure/);
  bounded(input);
 }finally{input.close();}
});

test('synthetic 1200 MiB file is read selectively without whole-file allocation',async()=>{
 const size=Math.round(1200*1024*1024),file=source(size),input=createChunkedInput(file,{chunkBytes:64});
 try{
  for(const offset of [0,Math.floor(size/2),size-12])assert.deepEqual(await input.read({offset,size:12},0),bytes(offset,12));
  assert.ok(file.calls.length<20);assert.ok(file.calls.every(([start,end])=>end-start<=64));bounded(input,64);
  assert.equal(input.getInputState().strategy,'chunked-prefetch');
 }finally{input.close();}
});

test('a delayed speculative read does not delay a ready cache hit',{timeout:3000},async()=>{
 const file=source(256,{deferred:true}),input=createChunkedInput(file,{chunkBytes:16});
 try{
  const first=input.read({offset:0,size:4},0);
  await tick();file.pending.shift()();assert.deepEqual(await first,bytes(0,4));await tick();
  assert.ok(input.getDiagnostics().activeReads>0,'lookahead remains in flight');
  assert.deepEqual(await input.read({offset:4,size:4},0),bytes(4,4));
  assert.ok(input.getDiagnostics().cacheHits>0);bounded(input);
 }finally{input.close();file.finish();await tick();}
});

test('simultaneous distant boundary crossings fit four reserved windows without deadlock',{timeout:3000},async()=>{
 const file=source(2048,{deferred:true}),input=createChunkedInput(file,{chunkBytes:16});
 try{
  let result;
  const pending=Promise.all([input.read({offset:13,size:8},0),input.read({offset:1037,size:8},1)]).then(value=>result=value);
  for(let i=0;i<10&&!result;i++){await tick();file.finish();await tick();bounded(input);}
  await pending;assert.deepEqual(result,[bytes(13,8),bytes(1037,8)]);
  assert.equal(input.getDiagnostics().maxReservedBytes,64);
 }finally{input.close();file.finish();await tick();}
});

test('backward seek and replay reuse ready buffers but discard pending lookahead',{timeout:3000},async()=>{
 const file=source(256,{deferred:true}),input=createChunkedInput(file,{chunkBytes:16});
 try{
  const first=input.read({offset:4,size:4},0);await tick();file.finish();await first;await tick();
  input.reset();
  assert.deepEqual(await input.read({offset:0,size:4},0),bytes(0,4));
  assert.equal(file.calls.filter(([start])=>start===0).length,1,'seek reused ready initial chunk');
  file.finish();await tick();
  input.reset();assert.deepEqual(await input.read({offset:4,size:4},1),bytes(4,4));
  assert.equal(file.calls.filter(([start])=>start===0).length,1);bounded(input);
 }finally{input.close();file.finish();await tick();}
});

test('queued demand is scheduled ahead of queued speculation after an active slot opens',{timeout:3000},async()=>{
 const file=source(2048,{deferred:true}),input=createChunkedInput(file,{chunkBytes:16,maxConcurrentReads:1});
 try{
  const first=input.read({offset:0,size:4},0);await tick();
  const distant=input.read({offset:1024,size:4},1);await tick();
  assert.deepEqual(file.calls,[[0,16]]);
  file.finish();await first;await tick();
  assert.deepEqual(file.calls[1],[1024,1040],'demand must precede first track speculation');
  file.finish();assert.deepEqual(await distant,bytes(1024,4));bounded(input);
 }finally{input.close();file.finish();await tick();}
});

test('read configuration and concurrent-consumer misuse fail without corrupting existing request',{timeout:3000},async()=>{
 for(const options of [{chunkBytes:0},{maxChunks:3},{maxConcurrentReads:0},{maxConcurrentReads:3}])assert.throws(()=>createChunkedInput(source(),options));
 const file=source(256,{deferred:true}),input=createChunkedInput(file,{chunkBytes:16});
 try{
  await assert.rejects(input.read({offset:0,size:1},2));
  const first=input.read({offset:0,size:4},0);
  await assert.rejects(input.read({offset:8,size:4},0),/pending/);
  await tick();file.finish();assert.deepEqual(await first,bytes(0,4));bounded(input);
 }finally{input.close();file.finish();await tick();}
});

test('declared audio consumers share bounds and cannot deadlock on distant crossing packets',{timeout:3000},async()=>{
 const file=source(4096),tracks=Array.from({length:4},(_,track)=>({samples:Array.from({length:12},(_,i)=>({offset:track*768+i*32+13,size:8}))}));
 const input=createChunkedInput(file,{chunkBytes:16,tracks});
 try{
  for(let i=0;i<12;i++){
   const data=await Promise.all([0,1,2].map(track=>input.read(tracks[track].samples[i],track,i)));
   data.forEach((value,track)=>assert.deepEqual(value,bytes(tracks[track].samples[i].offset,8)));bounded(input);
  }
  // A formerly unused alternate audio track can replace old-current entries.
  assert.deepEqual(await input.read(tracks[3].samples[0],3,0),bytes(tracks[3].samples[0].offset,8));bounded(input);
 }finally{input.close();}
});

test('telemetry, selected audio and paired video share four slots even across distant chunk boundaries',{timeout:3000},async()=>{
 const file=source(4096),tracks=Array.from({length:5},(_,track)=>({samples:Array.from({length:12},(_,i)=>({offset:track*768+i*32+13,size:8}))}));
 const input=createChunkedInput(file,{chunkBytes:16,tracks});
 try{
  for(let i=0;i<12;i++){
   const consumers=[0,1,i<6?2:3,4];
   const data=await Promise.all(consumers.map(track=>input.read(tracks[track].samples[i],track,i)));
   data.forEach((value,n)=>assert.deepEqual(value,bytes(tracks[consumers[n]].samples[i].offset,8)));bounded(input);
  }
 }finally{input.close();}
});
