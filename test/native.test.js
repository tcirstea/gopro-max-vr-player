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
 try{const p=await createNativePlayer(fixture(),{onFrames:(a,b)=>{assert.equal(a.timestamp,b.timestamp);presented.push(a.timestamp);},onError:e=>{throw e;}});await new Promise(r=>setImmediate(r));callback(performance.now());assert.deepEqual(presented,[0]);p.play();callback(performance.now()+100);assert.equal(p.playing,false);assert.deepEqual(presented,[0,40000]);p.seek(.04);await new Promise(r=>setImmediate(r));callback(performance.now());assert.equal(presented.at(-1),40000);p.close();assert.ok(frames.every(f=>f.closed));}finally{Object.assign(globalThis,saved);}
});
test('native unsupported codec fails before allocating decoders',async()=>{
 const secure=globalThis.isSecureContext,decoder=globalThis.VideoDecoder;
 try{globalThis.isSecureContext=true;globalThis.VideoDecoder=class{static async isConfigSupported(){return {supported:false};}constructor(){assert.fail('Decoder must not be allocated');}};await assert.rejects(createNativePlayer(fixture(),{onFrames(){}}),/cannot decode/);}finally{globalThis.isSecureContext=secure;globalThis.VideoDecoder=decoder;}
});
test('native partial decoder configuration failure releases allocated resources',async()=>{
 const secure=globalThis.isSecureContext,decoder=globalThis.VideoDecoder;let allocations=0,closed=0;
 try{globalThis.isSecureContext=true;globalThis.VideoDecoder=class{static async isConfigSupported(){return {supported:true};}constructor(){this.state='unconfigured';allocations++;}configure(){if(allocations===2)throw new Error('Hardware exhausted');this.state='configured';}close(){this.state='closed';closed++;}};await assert.rejects(createNativePlayer(fixture(),{onFrames(){}}),/Hardware exhausted/);assert.equal(closed,2);}finally{globalThis.isSecureContext=secure;globalThis.VideoDecoder=decoder;}
});
test('decoder backpressure bounds pending compressed samples to eight per stream',async()=>{
 const saved={};for(const k of ['isSecureContext','VideoDecoder','EncodedVideoChunk','requestAnimationFrame','cancelAnimationFrame'])saved[k]=globalThis[k];const counts=[];
 class Decoder{static async isConfigSupported(){return {supported:true};}constructor(){this.i=counts.length;counts.push(0);this.state='configured';}configure(){}decode(){counts[this.i]++;}close(){this.state='closed';}async flush(){}}
 Object.assign(globalThis,{isSecureContext:true,VideoDecoder:Decoder,EncodedVideoChunk:class{},requestAnimationFrame:()=>1,cancelAnimationFrame:()=>{}});
 try{const p=await createNativePlayer(fixture({counts:[20,20]}),{onFrames(){}});await new Promise(r=>setImmediate(r));assert.deepEqual(counts,[8,8]);p.close();}finally{Object.assign(globalThis,saved);}
});
