import {test} from 'node:test';
import assert from 'node:assert/strict';
import {demuxNative,hevcCodec} from '../src/native-demux.js';
import {createNativePlayer} from '../src/native-player.js';
const box=(type,...parts)=>{const p=Buffer.concat(parts),h=Buffer.alloc(8);h.writeUInt32BE(p.length+8);h.write(type,4);return Buffer.concat([h,p]);};
const words=(...values)=>{const b=Buffer.alloc(values.length*4);values.forEach((v,i)=>b.writeUInt32BE(v,i*4));return b;};
function fixture({offset=8,ctts=false,width=4096,counts=[3,2]}={}){
 const hvcc=Buffer.alloc(23);hvcc[0]=1;hvcc[1]=1;hvcc[2]=0x60;hvcc[12]=153;
 function track(count){const h=Buffer.alloc(12);h.write('vide',8);const entry=Buffer.alloc(78);entry.writeUInt16BE(width,24);entry.writeUInt16BE(1344,26);
 return box('trak',box('mdia',box('hdlr',h),box('mdhd',words(0,0,0,1000, count*40)),box('minf',box('stbl',box('stsd',words(0,1),box('hvc1',entry,box('hvcC',hvcc))),box('stsz',words(0,1,count)),box('stts',words(0,1,count,40)),box('stss',words(0,1,1)),box('stsc',words(0,1,1,count,1)),box('stco',words(0,1,offset)),...(ctts?[box('ctts',words(0,1,count,1))]:[])))));}
 return new File([box('mdat',Buffer.alloc(Math.max(...counts))),box('moov',...counts.map(track))],'sample.360');
}
test('native sample tables preserve byte positions and microsecond timestamps',async()=>{const d=await demuxNative(fixture());assert.equal(d.duration,.08);assert.equal(d.tracks[0].config.codec,'hvc1.1.6.L153');assert.deepEqual(d.tracks[0].samples.map(s=>[s.offset,s.timestamp,s.duration,s.key]),[[8,0,40000,true],[9,40000,40000,false],[10,80000,40000,false]]);assert.equal((await d.read(d.tracks[0].samples[0])).byteLength,1);});
test('rejects invalid offsets, unsupported dimensions and reordered timestamps',async()=>{await assert.rejects(demuxNative(fixture({offset:999999})),/outside/);await assert.rejects(demuxNative(fixture({ctts:true})),/Reordered/);await assert.rejects(demuxNative(fixture({width:12})),/4096/);});
test('HEVC profile, tier, compatibility bit order and constraints codec string',()=>{const b=new Uint8Array(23);b[0]=1;b[1]=0x61;b[2]=0x60;b[6]=0xb0;b[12]=153;assert.equal(hevcCodec(b),'hvc1.A1.6.H153.B0');assert.throws(()=>hevcCodec(new Uint8Array(4)),/Invalid/);});
test('dual decoder pairs timestamps, stops at common duration, seeks and closes frames',async()=>{
 const saved={};for(const k of ['isSecureContext','VideoDecoder','EncodedVideoChunk','requestAnimationFrame','cancelAnimationFrame'])saved[k]=globalThis[k];
 const frames=[],presented=[];let callback;
 class FakeDecoder{static async isConfigSupported(config){return {supported:true,config};}constructor(opts){this.opts=opts;this.state='unconfigured';}configure(){this.state='configured';}decode(chunk){queueMicrotask(()=>{if(this.state==='closed')return;const f={timestamp:chunk.timestamp,duration:chunk.duration,closed:false,close(){this.closed=true;}};frames.push(f);this.opts.output(f);});}async flush(){}close(){this.state='closed';}}
 Object.assign(globalThis,{isSecureContext:true,VideoDecoder:FakeDecoder,EncodedVideoChunk:class{constructor(x){Object.assign(this,x);}},requestAnimationFrame:cb=>{callback=cb;return 1;},cancelAnimationFrame:()=>{}});
 try{const p=await createNativePlayer(fixture(),{onFrames:(a,b)=>{assert.equal(a.timestamp,b.timestamp);presented.push(a.timestamp);},onError:e=>{throw e;}});await new Promise(r=>setImmediate(r));callback(performance.now());assert.deepEqual(presented,[0]);p.play();const now=performance.now();callback(now);callback(now+100);assert.equal(p.playing,false);assert.deepEqual(presented,[0,40000]);p.seek(.04);await new Promise(r=>setImmediate(r));callback(performance.now());assert.equal(presented.at(-1),40000);p.close();assert.ok(frames.every(f=>f.closed));}finally{Object.assign(globalThis,saved);}
});
test('native unsupported codec fails before allocating decoders',async()=>{
 const secure=globalThis.isSecureContext,decoder=globalThis.VideoDecoder;
 try{globalThis.isSecureContext=true;globalThis.VideoDecoder=class{static async isConfigSupported(){return {supported:false};}constructor(){assert.fail('Decoder must not be allocated');}};await assert.rejects(createNativePlayer(fixture(),{onFrames(){}}),/cannot decode/);}finally{globalThis.isSecureContext=secure;globalThis.VideoDecoder=decoder;}
});
test('native partial decoder configuration failure releases allocated resources',async()=>{
 const secure=globalThis.isSecureContext,decoder=globalThis.VideoDecoder;let allocations=0,closed=0;
 try{globalThis.isSecureContext=true;globalThis.VideoDecoder=class{static async isConfigSupported(){return {supported:true};}constructor(){this.state='unconfigured';allocations++;}configure(){if(allocations===2)throw new Error('Hardware exhausted');this.state='configured';}close(){this.state='closed';closed++;}};await assert.rejects(createNativePlayer(fixture(),{onFrames(){}}),/Hardware exhausted/);assert.equal(closed,2);}finally{globalThis.isSecureContext=secure;globalThis.VideoDecoder=decoder;}
});
test('decoder backpressure bounds retained inputs even if codec never emits',async()=>{
 const saved={};for(const k of ['isSecureContext','VideoDecoder','EncodedVideoChunk','requestAnimationFrame','cancelAnimationFrame'])saved[k]=globalThis[k];const counts=[];
 class Decoder{static async isConfigSupported(){return {supported:true};}constructor(){this.i=counts.length;counts.push(0);this.state='configured';}configure(){}decode(){counts[this.i]++;}close(){this.state='closed';}async flush(){}}
 Object.assign(globalThis,{isSecureContext:true,VideoDecoder:Decoder,EncodedVideoChunk:class{},requestAnimationFrame:()=>1,cancelAnimationFrame:()=>{}});
 try{const p=await createNativePlayer(fixture({counts:[40,40]}),{onFrames(){}});await new Promise(r=>setImmediate(r));assert.deepEqual(counts,[24,24]);p.close();}finally{Object.assign(globalThis,saved);}
});

// Simulates codecs whose requests dequeue immediately but outputs are held by
// the hardware until a batch is available (unlike immediate-output mocks).
async function delayedHarness(run){
 const keys=['isSecureContext','VideoDecoder','EncodedVideoChunk','requestAnimationFrame','cancelAnimationFrame'];
 const saved=Object.fromEntries(keys.map(k=>[k,globalThis[k]]));
 const decoders=[],allFrames=[],presented=[];let callback;
 class Decoder{
  static async isConfigSupported(){return {supported:true};}
  constructor(opts){this.opts=opts;this.state='configured';this.chunks=[];this.decodeQueueSize=0;decoders.push(this);}
  configure(){} decode(chunk){this.chunks.push(chunk);}
  emit(count=Infinity){for(const chunk of this.chunks.splice(0,count)){const f={timestamp:chunk.timestamp,duration:chunk.duration,closed:false,close(){this.closed=true;}};allFrames.push(f);this.opts.output(f);}}
  async flush(){this.emit();} close(){this.state='closed';}
 }
 Object.assign(globalThis,{isSecureContext:true,VideoDecoder:Decoder,EncodedVideoChunk:class{constructor(x){Object.assign(this,x);}},requestAnimationFrame:cb=>{callback=cb;return 1;},cancelAnimationFrame:()=>{}});
 const settle=()=>new Promise(r=>setImmediate(r));
 let p;
 try{p=await createNativePlayer(fixture({counts:[100,100]}),{onFrames:(a,b)=>{assert.equal(a.timestamp,b.timestamp);presented.push(a.timestamp);}});await settle();await run({p,decoders,allFrames,presented,tick:n=>callback(n),settle});}
 finally{p?.close();assert.ok(allFrames.every(f=>f.closed));Object.assign(globalThis,saved);}
}
test('delayed outputs beyond eight inputs can progress; only one paired upload per animation frame',async()=>{
 await delayedHarness(async({p,decoders,presented,tick,settle})=>{
  assert.deepEqual(decoders.map(d=>d.chunks.length),[24,24]);
  decoders.forEach(d=>d.emit(12));await settle();tick(0);assert.deepEqual(presented,[0]);
  p.play();tick(10);tick(110);assert.equal(presented.length,2);assert.equal(presented.at(-1),80000);
  assert.equal(p.getDiagnostics().counters.droppedPairs,1);
 });
});
test('decoder starvation freezes clock and never falsely reaches end; resumes without skipping footage',async()=>{
 await delayedHarness(async({p,decoders,presented,tick,settle})=>{
  decoders.forEach(d=>d.emit(4));await settle();tick(0);p.play();tick(1);tick(101);tick(201);
  const before=p.getDiagnostics();assert.equal(before.state.buffering,true);assert.ok(before.state.mediaClock<.2);
  for(let n=301;n<10000;n+=100)tick(n);
  assert.equal(p.playing,true);assert.equal(p.getDiagnostics().state.mediaClock,before.state.mediaClock);
  // One decoder alone must not cause a mismatched upload or advance time.
  decoders[0].emit(4);await settle();tick(10001);assert.equal(p.getDiagnostics().state.buffering,true);
  decoders[1].emit(4);await settle();tick(10101);
  assert.equal(p.getDiagnostics().state.buffering,false);assert.equal(presented.at(-1),160000);
  assert.ok(p.getDiagnostics().state.mediaClock<.2);
 });
});
test('seeking while playing rebuffers and stale decoder output is closed',async()=>{
 await delayedHarness(async({p,decoders,allFrames,tick,settle})=>{
  p.play();p.seek(1);const old=decoders.slice(0,2);old.forEach(d=>d.emit());await settle();
  assert.ok(allFrames.every(f=>f.closed));tick(10000);assert.equal(p.getDiagnostics().state.mediaClock,1);
  p.pause();assert.equal(p.getDiagnostics().state.buffering,false);
 });
});
test('batched decode drains to actual final pair, then replay starts from zero',async()=>{
 await delayedHarness(async({p,decoders,presented,tick,settle})=>{
  p.play();
  for(let now=0;now<7000&&p.playing;now+=40){decoders.slice(0,2).forEach(d=>d.emit(4));await settle();tick(now);}
  assert.equal(p.playing,false);assert.equal(p.getDiagnostics().state.currentTime,4);
  assert.equal(presented.at(-1),3960000);
  tick(7500);assert.equal(p.getDiagnostics().state.mediaClock,4,'EOF remains at the end on later paused ticks');
  p.play();assert.equal(p.playing,true);assert.equal(p.getDiagnostics().state.mediaClock,0);
  await settle();decoders.slice(2).forEach(d=>d.emit(4));await settle();tick(8000);
  assert.equal(presented.at(-1),0);
 });
});

test('decoder failure releases input and cannot be revived by seek or play',async()=>{
 await delayedHarness(async({p,decoders})=>{
  p.play();decoders[0].opts.error(new Error('Decode failed'));
  const before=p.getDiagnostics();assert.equal(before.state.failed,true);assert.equal(before.state.playing,false);
  assert.ok(before.input.every(i=>i.cachedBytes===0));
  p.seek(1);p.play();assert.equal(p.getDiagnostics().state.failed,true);assert.equal(p.playing,false);
  assert.equal(p.getDiagnostics().counters.seeks,before.counters.seeks);assert.equal(decoders.length,2);
 });
});
