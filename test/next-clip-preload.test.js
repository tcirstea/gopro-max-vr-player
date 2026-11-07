import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createNextClipPreloader,prepareNextClip,shouldPreloadNext,NEXT_CLIP_PRELOAD_BYTES,BROWSER_PRELOAD_PREFIX_BYTES} from '../src/next-clip-preload.js';
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
const payload=()=>({closed:0,close(){this.closed++;}});
const box=(type,...parts)=>{const body=Buffer.concat(parts),header=Buffer.alloc(8);header.writeUInt32BE(body.length+8);header.write(type,4);return Buffer.concat([header,body]);};
const words=(...values)=>{const bytes=Buffer.alloc(values.length*4);values.forEach((v,i)=>bytes.writeUInt32BE(v,i*4));return bytes;};
function movie({native=true}={}){
 const handler=Buffer.alloc(12);handler.write('vide',8);const entry=Buffer.alloc(78);entry.writeUInt16BE(native?4096:400,24);entry.writeUInt16BE(native?1344:200,26);
 const hvcc=Buffer.alloc(23);hvcc[0]=1;hvcc[1]=1;hvcc[2]=0x60;hvcc[12]=153;
 const track=box('trak',box('mdia',box('hdlr',handler),box('mdhd',words(0,0,0,1000,80)),box('minf',box('stbl',box('stsd',words(0,1),box(native?'hvc1':'avc1',entry,...(native?[box('hvcC',hvcc)]:[]))),box('stsz',words(0,1,2)),box('stts',words(0,1,2,40)),box('stss',words(0,1,1)),box('stsc',words(0,1,1,2,1)),box('stco',words(0,1,8))))));
 return new File([box('mdat',Buffer.from([5,7])),box('moov',track,...(native?[track]:[]))],native?'synthetic.360':'synthetic.mp4',{type:'video/mp4'});
}
test('prefetch is limited to advancing playback within the final 15 seconds',()=>{
 const state={playing:true,currentTime:85,duration:100};assert.equal(shouldPreloadNext(state),true);
 for(const change of [{currentTime:84.9},{playing:false},{buffering:true},{preparing:true},{duration:Infinity},{currentTime:NaN},{currentTime:100},{currentTime:0},{duration:0}])assert.equal(shouldPreloadNext({...state,...change}),false);
 assert.equal(shouldPreloadNext({playing:true,currentTime:.01,duration:2}),true);
});
test('exact ready successor is transferred once and never disposed by its former owner',async()=>{
 const value=payload(),file={},calls=[];const cache=createNextClipPreloader({prepare:async(f,o)=>{calls.push([f,o]);return value;}});
 cache.consider('next',file,{confirmed:true});cache.consider('next',file);await settle();
 assert.equal(calls.length,1);assert.equal(calls[0][1].confirmed,true);assert.equal(cache.take('next',file),value);cache.close();assert.equal(value.closed,0);assert.equal(cache.take('next',file),null);value.close();
});
test('a wrong identity, cancellation, close and queue reorder discard staged resources',async()=>{
 for(const mode of ['file','key','cancel','close','reorder']){
  const value=payload(),file={},cache=createNextClipPreloader({prepare:async()=>value});cache.consider('a',file);await settle();
  if(mode==='file')assert.equal(cache.take('a',{}),null);
  if(mode==='key')assert.equal(cache.take('b',file),null);
  if(mode==='cancel')cache.cancel();if(mode==='close')cache.close();if(mode==='reorder')cache.consider('b',{});
  assert.equal(value.closed,1);cache.close();
 }
});
test('canceled reads stay serialized through repeated retargeting, and late bytes cannot become ready',async()=>{
 const reads=[],values=[];const cache=createNextClipPreloader({prepare:(file,{signal})=>{const d=deferred();reads.push({file,signal,...d});return d.promise;}});
 cache.consider('a',{});await settle();cache.consider('b',{});cache.consider('c',{});await settle();assert.equal(reads.length,1);assert.equal(reads[0].signal.aborted,true);
 const stale=payload();reads[0].resolve(stale);await settle();assert.equal(stale.closed,1);assert.equal(reads.length,2);
 const current=payload();reads[1].resolve(current);await settle();assert.equal(cache.take('c',reads[1].file),current);current.close();cache.close();
});
test('incomplete work never delays handoff and failures are retried only by normal open or a changed selection',async()=>{
 let calls=0;const d=deferred(),file={},cache=createNextClipPreloader({prepare:()=>{calls++;return d.promise;}});cache.consider('a',file);await settle();assert.equal(cache.take('a',file),null);const value=payload();d.resolve(value);await settle();assert.equal(value.closed,1);assert.equal(calls,1);
 const failed=createNextClipPreloader({prepare:async()=>{calls++;throw Error('read failed');}});failed.consider('a',file);await settle();for(let i=0;i<5;i++)failed.consider('a',file);await settle();assert.equal(calls,2);assert.equal(failed.take('a',file),null);failed.close();cache.close();
});
test('disposal during an uncancelable read prevents any later restart or retained payload',async()=>{
 const d=deferred(),value=payload();let calls=0;const cache=createNextClipPreloader({prepare:()=>{calls++;return d.promise;}});cache.consider('a',{});await settle();cache.close();cache.consider('b',{});d.resolve(value);await settle();assert.equal(calls,1);assert.equal(value.closed,1);
});
test('native preparation reads and reuses compressed input without constructing any video/audio decoder',async()=>{
 const saved=Object.fromEntries(['VideoDecoder','AudioDecoder','AudioContext'].map(k=>[k,globalThis[k]]));
 for(const k of Object.keys(saved))globalThis[k]=class{constructor(){assert.fail(`Standby must not create ${k}`);}};
 try{
  const file=movie(),ready=await prepareNextClip(file,{signal:new AbortController().signal});
  assert.equal(ready.info.nativeCandidate,true);assert.equal(ready.movie.getInputState().preparing,false);assert.equal(ready.movie.getReadDiagnostics()[0].readOperations,1);
  ready.movie.reset();assert.deepEqual(await ready.movie.read(ready.movie.tracks[0].samples[0]),new Uint8Array([5]));assert.equal(ready.movie.getReadDiagnostics()[0].readOperations,1);
  ready.close();assert.equal(ready.movie.getReadDiagnostics()[0].cachedBytes,0);
 }finally{Object.assign(globalThis,saved);}
});
test('browser preload is byte-identical, local and projection-gated, with bounded prefix and copy allowance',async()=>{
 const file=movie({native:false});
 const unconfirmed=await prepareNextClip(file,{signal:new AbortController().signal});assert.equal(unconfirmed.blob,undefined);assert.equal(unconfirmed.movie,undefined);
 const ready=await prepareNextClip(file,{signal:new AbortController().signal,confirmed:true});assert.deepEqual(await ready.blob.arrayBuffer(),await file.arrayBuffer());assert.equal(ready.blob.type,'video/mp4');ready.close();assert.equal(ready.blob,null);
 assert.equal(BROWSER_PRELOAD_PREFIX_BYTES*2,NEXT_CLIP_PRELOAD_BYTES);assert.equal(NEXT_CLIP_PRELOAD_BYTES,64*1024*1024);
 // Keep valid tiny metadata at the front and lazily synthesize a long tail.
 const prefix=new Uint8Array(await file.arrayBuffer()),tail=box('mdat',Buffer.alloc(1));tail.writeUInt32BE(BROWSER_PRELOAD_PREFIX_BYTES+64);
 const total=prefix.length+BROWSER_PRELOAD_PREFIX_BYTES+64,reads=[];
 const large={name:'synthetic.mp4',size:total,type:'video/mp4',slice(start=0,end=total){reads.push([start,end]);const data=new Uint8Array(end-start);for(const [at,bytes] of [[0,prefix],[prefix.length,tail]]){const a=Math.max(at,start),b=Math.min(at+bytes.length,end);if(b>a)data.set(bytes.subarray(a-at,b-at),a-start);}return new Blob([data]);}};
 const warmed=await prepareNextClip(large,{confirmed:true});assert.equal(warmed.blob.size,total);assert.ok(reads.some(([a,b])=>a===0&&b===BROWSER_PRELOAD_PREFIX_BYTES));warmed.close();
});
test('cancellation and malformed input cannot escape the preparation lifecycle',async()=>{
 const abort=new AbortController();abort.abort();await assert.rejects(prepareNextClip(movie(),{signal:abort.signal}),{name:'AbortError'});
 await assert.rejects(prepareNextClip(new File(['bad'],'bad.360'),{}),/Truncated/);
 const file=movie();let reads=0;const controller=new AbortController();const wrapper={size:file.size,name:file.name,slice(a,b){reads++;if(reads===4)controller.abort();return file.slice(a,b);}};
 await assert.rejects(prepareNextClip(wrapper,{signal:controller.signal}),{name:'AbortError'});
});
