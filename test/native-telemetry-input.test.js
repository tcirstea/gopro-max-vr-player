import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createNativePlayer} from '../src/native-player.js';
import {demuxNative} from '../src/native-demux.js';

const box=(type,...parts)=>{const p=Buffer.concat(parts),h=Buffer.alloc(8);h.writeUInt32BE(p.length+8);h.write(type,4);return Buffer.concat([h,p]);};
const words=(...v)=>{const b=Buffer.alloc(v.length*4);v.forEach((x,i)=>b.writeUInt32BE(x,i*4));return b;};
const klv=(key,type,size,count,raw)=>{const h=Buffer.alloc(8),data=Buffer.alloc(Math.ceil(raw.length/4)*4);h.write(key);h[4]=type.charCodeAt(0);h[5]=size;h.writeUInt16BE(count,6);raw.copy(data);return Buffer.concat([h,data]);};
const nested=(key,...items)=>{const raw=Buffer.concat(items);return klv(key,'\0',1,raw.length,raw);};
function packet(index){
 const raw=Buffer.alloc(25*8);for(let i=0;i<25;i++)raw.writeInt16BE(32767,i*8);
 const stream=key=>nested('STRM',klv('TSMP','L',4,1,words((index+1)*25)),klv('SCAL','s',2,1,Buffer.from([127,255])),klv(key,'s',8,25,raw));
 return nested('DEVC',stream('CORI'),stream('IORI'));
}
// Synthetic sparse media, never camera footage. Exact per-packet reads after
// the first intentionally stall; the shared compressed chunk is already ready.
function fixture({large=true,delayChunks=false,withAudio=false}={}){
 const count=100,hvcc=Buffer.alloc(23);hvcc[0]=1;hvcc[1]=1;hvcc[2]=0x60;hvcc[12]=153;
 const mdia=(description,sizes,timing,offsets,handler='meta')=>{const h=Buffer.alloc(12);h.write(handler,8);return box('trak',box('mdia',box('hdlr',h),box('mdhd',words(0,0,0,1000,4000)),box('minf',box('stbl',box('stsd',words(0,1),description),box('stsz',sizes),box('stts',timing),box('stss',words(0,1,1)),box('stsc',words(0,1,1,handler==='meta'?1:count,1)),box('stco',words(0,offsets.length,...offsets))))));};
 const entry=Buffer.alloc(78);entry.writeUInt16BE(4096,24);entry.writeUInt16BE(1344,26);
 const video=mdia(box('hvc1',entry,box('hvcC',hvcc)),words(0,1,count),words(0,1,count,40),[8],'vide');
 const packets=Array.from({length:4},(_,i)=>({offset:1024*1024+i*4096,data:packet(i)}));
 const telemetry=mdia(box('gpmd',Buffer.alloc(8)),words(0,0,4,...packets.map(p=>p.data.length)),words(0,1,4,1000),packets.map(p=>p.offset));
 const sound=Buffer.alloc(28);sound.writeUInt16BE(2,16);sound.writeUInt32BE(48000*65536,24);
 const asc=Buffer.from([5,2,0x11,0x90]),dc=Buffer.concat([Buffer.from([0x40,0x15]),Buffer.alloc(11),asc]),es=Buffer.concat([Buffer.from([0,1,0,4,dc.length]),dc]);
 const audio=mdia(box('mp4a',sound,box('esds',words(0),Buffer.from([3,es.length]),es)),words(0,1,count),words(0,1,count,40),[8],'soun');
 const moov=box('moov',video,video,...(withAudio?[audio,audio]:[]),telemetry),mdatBytes=(large?128:2)*1024*1024,header=words(mdatBytes);const mdat=Buffer.concat([header,Buffer.from('mdat')]);
 const regions=[[0,mdat],[mdatBytes,moov],...packets.map(p=>[p.offset,p.data])],exactReads=[],pendingChunks=[];
 return {size:mdatBytes+moov.length,exactReads,pendingChunks,slice(start,end){return {arrayBuffer(){
  const packetIndex=packets.findIndex(p=>p.offset===start&&p.offset+p.data.length===end);
  if(packetIndex>=0){exactReads.push(packetIndex);if(packetIndex>0)return new Promise(()=>{});}
  const produce=()=>{const data=new Uint8Array(end-start);for(const [offset,bytes] of regions){const a=Math.max(start,offset),b=Math.min(end,offset+bytes.length);if(b>a)data.set(bytes.subarray(a-offset,b-offset),a-start);}return data.buffer;};
  if(delayChunks&&end-start>=64*1024*1024)return new Promise(resolve=>pendingChunks.push(()=>resolve(produce())));
  return Promise.resolve(produce());
 }};}};
}
for(const large of [false,true])test(`native telemetry uses ${large?'large shared chunks':'the prepared small-file buffer'} across packet boundaries`,async()=>{
 const keys=['isSecureContext','VideoDecoder','EncodedVideoChunk','requestAnimationFrame','cancelAnimationFrame'];
 const saved=Object.fromEntries(keys.map(k=>[k,globalThis[k]])),frames=[],presented=[];
 class Decoder{static async isConfigSupported(){return {supported:true};}constructor(options){this.options=options;this.state='configured';}configure(){}decode(chunk){queueMicrotask(()=>{if(this.state==='closed')return;const frame={timestamp:chunk.timestamp,duration:chunk.duration,closed:false,close(){this.closed=true;}};frames.push(frame);this.options.output(frame);});}async flush(){}close(){this.state='closed';}}
 Object.assign(globalThis,{isSecureContext:true,VideoDecoder:Decoder,EncodedVideoChunk:class{constructor(c){Object.assign(this,c);}},requestAnimationFrame:()=>1,cancelAnimationFrame(){}});
 let player;const settle=()=>new Promise(resolve=>setImmediate(resolve));
 try{
  const file=fixture({large});player=await createNativePlayer(file,{autoTick:false,onFrames(a,b,options){assert.equal(a.timestamp,b.timestamp);assert.deepEqual(options.stabilization,[1,0,0,0]);presented.push(a.timestamp);}});
  await settle();player.advance(0);player.play();
  for(let now=0;now<=4200;now+=40){await settle();player.advance(now);}
  assert.equal(presented.at(-1),3960000,'packet-boundary telemetry I/O must not starve video');
  assert.equal(player.playing,false);assert.equal(player.getDiagnostics().counters.bufferingEvents,1,'only initial startup buffers');
  assert.deepEqual(file.exactReads,[],'telemetry must not bypass the already-ready shared input');
  assert.equal(player.getDiagnostics().input[0].readOperations,1);
  assert.equal(player.getDiagnostics().stabilization.packetsRead,4);
 }finally{player?.close();assert.ok(frames.every(frame=>frame.closed));Object.assign(globalThis,saved);}
});

test('demux declares telemetry after both audio consumers and shares their physical reads',async()=>{
 const file=fixture({withAudio:true}),movie=await demuxNative(file);
 try{
  assert.deepEqual(movie.audioTracks.map(track=>track.inputIndex),[2,3]);assert.equal(movie.telemetry.inputIndex,4);
  const tracks=[...movie.tracks,...movie.audioTracks,movie.telemetry];
  const data=await Promise.all(tracks.map((track,index)=>movie.read(track.samples[0],index,0)));
  data.forEach((bytes,index)=>assert.equal(bytes.byteLength,tracks[index].samples[0].size));
  assert.equal(movie.getReadDiagnostics()[0].readOperations,1);assert.deepEqual(file.exactReads,[]);
 }finally{movie.close();}
});

test('repeated seeks cancel telemetry consumers while shared chunk reservations remain bounded',async()=>{
 const keys=['isSecureContext','VideoDecoder','EncodedVideoChunk','requestAnimationFrame','cancelAnimationFrame'];
 const saved=Object.fromEntries(keys.map(k=>[k,globalThis[k]])),decoders=[],presented=[];
 class Decoder{static async isConfigSupported(){return {supported:true};}constructor(options){this.options=options;this.state='configured';this.submitted=0;decoders.push(this);}configure(){}decode(chunk){this.submitted++;queueMicrotask(()=>{if(this.state!=='closed')this.options.output({timestamp:chunk.timestamp,duration:chunk.duration,close(){}});});}async flush(){}close(){this.state='closed';}}
 Object.assign(globalThis,{isSecureContext:true,VideoDecoder:Decoder,EncodedVideoChunk:class{constructor(c){Object.assign(this,c);}},requestAnimationFrame:()=>1,cancelAnimationFrame(){}});
 let player;const settle=()=>new Promise(resolve=>setImmediate(resolve));
 try{
  const file=fixture({delayChunks:true});player=await createNativePlayer(file,{autoTick:false,onFrames(a,b,{stabilization}){assert.deepEqual(stabilization,[1,0,0,0]);presented.push(a.timestamp);}});await settle();
  assert.equal(player.getDiagnostics().stabilization.pendingPackets,1);
  for(let i=0;i<20;i++){player.seek(1+(i%3)*.2);await settle();}
  assert.equal(file.pendingChunks.length,2);assert.ok(decoders.every(d=>d.submitted===0));
  file.pendingChunks.splice(0).forEach(finish=>finish());await settle();assert.equal(file.pendingChunks.length,1);
  file.pendingChunks.shift()();await settle();player.advance(0);
  const snapshot=player.getDiagnostics();assert.equal(snapshot.stabilization.enabled,true);assert.equal(snapshot.stabilization.pendingPackets,0);assert.equal(snapshot.state.failed,false);assert.ok(presented.length>0);
  assert.ok(decoders.slice(0,-2).every(d=>d.submitted===0));assert.equal(snapshot.input[0].maxActiveReads,2);assert.ok(snapshot.input[0].maxReservedBytes<=256*1024*1024);assert.deepEqual(file.exactReads,[]);
  player.close();assert.equal(player.getDiagnostics().stabilization.cachedPackets,0);assert.equal(player.getDiagnostics().input[0].cachedBytes,0);
 }finally{player?.close();Object.assign(globalThis,saved);}
});
