import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createNativePlayer} from '../src/native-player.js';
const box=(type,...parts)=>{const p=Buffer.concat(parts),h=Buffer.alloc(8);h.writeUInt32BE(p.length+8);h.write(type,4);return Buffer.concat([h,p]);};
const words=(...v)=>{const b=Buffer.alloc(v.length*4);v.forEach((x,i)=>b.writeUInt32BE(x,i*4));return b;};
function fixture(){
 const count=100,hvcc=Buffer.alloc(23);hvcc[0]=1;hvcc[1]=1;hvcc[2]=0x60;hvcc[12]=153;
 function track(audio){const h=Buffer.alloc(12);h.write(audio?'soun':'vide',8);const entry=Buffer.alloc(audio?28:78);let desc;
  if(audio){entry.writeUInt16BE(2,16);entry.writeUInt32BE(48000*65536,24);const asc=Buffer.from([5,2,0x11,0x90]);const dc=Buffer.concat([Buffer.from([0x40,0x15]),Buffer.alloc(11),asc]);const es=Buffer.concat([Buffer.from([0,1,0,4,dc.length]),dc]);desc=box('mp4a',entry,box('esds',words(0),Buffer.from([3,es.length]),es));}
  else{entry.writeUInt16BE(4096,24);entry.writeUInt16BE(1344,26);desc=box('hvc1',entry,box('hvcC',hvcc));}
  return box('trak',box('mdia',box('hdlr',h),box('mdhd',words(0,0,0,1000,count*40)),box('minf',box('stbl',box('stsd',words(0,1),desc),box('stsz',words(0,1,count)),box('stts',words(0,1,count,40)),box('stss',words(0,1,1)),box('stsc',words(0,1,1,count,1)),box('stco',words(0,1,8))))));
 }
 return new File([box('mdat',Buffer.alloc(count)),box('moov',track(false),track(false),track(true))],'private.360');
}
async function harness(run,{manual=false}={}){
 const keys=['isSecureContext','VideoDecoder','EncodedVideoChunk','AudioContext','AudioDecoder','EncodedAudioChunk','requestAnimationFrame','cancelAnimationFrame'];const saved=Object.fromEntries(keys.map(k=>[k,globalThis[k]]));
 const videos=[],contexts=[],sources=[],frames=[];let tick,windowRequests=0;
 class VideoDecoder{static async isConfigSupported(){return {supported:true};}constructor(o){this.o=o;this.state='configured';this.chunks=[];videos.push(this);}configure(){}decode(c){this.chunks.push(c);}emit(n=4){for(const c of this.chunks.splice(0,n)){const f={timestamp:c.timestamp,duration:c.duration,closed:false,close(){this.closed=true;}};frames.push(f);this.o.output(f);}}async flush(){this.emit(Infinity);}close(){this.state='closed';}}
 class AudioDecoder{static async isConfigSupported(){return {supported:true};}constructor(o){this.o=o;this.state='configured';}configure(){}decode(c){queueMicrotask(()=>{if(this.state==='closed')return;this.o.output({timestamp:c.timestamp,sampleRate:48000,numberOfChannels:2,numberOfFrames:1920,copyTo(p){p.fill(.1);},close(){}});});}async flush(){}close(){this.state='closed';}}
 class AudioContext{constructor(){this.currentTime=0;this.state='suspended';this.destination={};contexts.push(this);}createGain(){return {gain:{value:0,setValueAtTime(){}},connect(){},disconnect(){}};}createBuffer(c,n,rate){return {numberOfChannels:c,length:n,sampleRate:rate,copyToChannel(){}};}createBufferSource(){const s={connect(){},disconnect(){},start(when,offset,duration){Object.assign(this,{when,offset,duration});},stop(){this.stopped=true;}};sources.push(s);return s;}async resume(){this.state='running';}async close(){this.state='closed';}}
 Object.assign(globalThis,{isSecureContext:true,VideoDecoder,AudioDecoder,AudioContext,EncodedVideoChunk:class{constructor(c){Object.assign(this,c);}},EncodedAudioChunk:class{constructor(c){Object.assign(this,c);}},requestAnimationFrame:cb=>{windowRequests++;tick=cb;return 1;},cancelAnimationFrame(){}});
 let player;const presented=[],settle=()=>new Promise(r=>setImmediate(r));
 try{player=await createNativePlayer(fixture(),{autoTick:!manual,onFrames(a,b){assert.equal(a.timestamp,b.timestamp);presented.push(a.timestamp);}});await settle();await run({player,videos,contexts,sources,presented,tick:n=>manual?player.advance(n):tick(n),windowRequests:()=>windowRequests,settle});}
 finally{player?.close();assert.ok(frames.every(f=>f.closed));Object.assign(globalThis,saved);}
}
test('native audio master clock freezes at paired video starvation and resumes at the same timestamp',async()=>{
 await harness(async({player,videos,contexts,sources,presented,tick,settle})=>{
  assert.equal(player.audioState.mode,'stereo');videos.forEach(v=>v.emit());await settle();tick(0);
  await player.play();await settle();tick(1);assert.equal(player.getDiagnostics().state.buffering,false);
  const ctx=contexts[0];assert.ok(sources.length>0);assert.ok(sources.every(s=>s.when+s.duration<=.18));
  ctx.currentTime=.2;tick(201);ctx.currentTime=.4;tick(401);
  const stalled=player.getDiagnostics();assert.equal(stalled.state.buffering,true);assert.ok(Math.abs(stalled.state.mediaClock-.16)<1e-6);
  ctx.currentTime=30;tick(30000);assert.equal(player.getDiagnostics().state.mediaClock,stalled.state.mediaClock);assert.equal(player.playing,true);
  videos.forEach(v=>v.emit());await settle();tick(30001);assert.equal(player.getDiagnostics().state.buffering,false);assert.equal(presented.at(-1),160000);
  player.pause();assert.equal(player.playing,false);assert.ok(sources.every(s=>s.stopped));
 });
});
test('native seeking stops old audio and muted playback retains synchronized timeline',async()=>{
 await harness(async({player,videos,contexts,sources,tick,settle})=>{
  videos.forEach(v=>v.emit());await settle();tick(0);await player.play();await settle();tick(1);
  const old=sources.slice();player.setMuted(false);player.setMuted(true);contexts[0].currentTime=.08;tick(81);
  assert.ok(player.getDiagnostics().state.mediaClock>0);assert.equal(player.getDiagnostics().audio.muted,true);
  player.seek(2);assert.ok(old.every(s=>s.stopped));await settle();videos.slice(2).forEach(v=>v.emit(Infinity));await settle();tick(82);
  assert.equal(player.getDiagnostics().state.mediaClock,2);assert.ok(player.getDiagnostics().audio.clock>=2);
  player.close();assert.equal(contexts[0].state,'closed');
 });
});

test('native AudioContext suspension preserves the elapsed audio instant when buffering',async()=>{
 await harness(async({player,videos,contexts,tick,settle})=>{
  videos.forEach(v=>v.emit());await settle();tick(0);await player.play();await settle();tick(1);
  const context=contexts[0];context.currentTime=.08;context.state='suspended';tick(81);
  const state=player.getDiagnostics().state;
  assert.equal(state.buffering,true);
  assert.ok(Math.abs(state.mediaClock-.06)<1e-7,`suspension rewound audio to ${state.mediaClock}`);
  context.state='running';tick(82);
  assert.ok(Math.abs(player.getDiagnostics().state.mediaClock-.06)<1e-7);
 });
});

test('native media advances on the renderer clock without relying on window animation frames',async()=>{
 await harness(async({player,videos,contexts,presented,tick,windowRequests,settle})=>{
  assert.equal(windowRequests(),0);
  videos.forEach(v=>v.emit());await settle();tick(0);assert.equal(presented.at(-1),0);
  await player.play();await settle();tick(1);contexts[0].currentTime=.1;tick(101);
  assert.ok(player.getDiagnostics().state.mediaClock>.07);assert.equal(presented.at(-1),80000);
  assert.equal(windowRequests(),0,'external advancement never registers a second window loop');
  player.close();const before=presented.length;tick(201);assert.equal(presented.length,before);
 },{manual:true});
});
test('native player forwards persistent volume independently of mute',async()=>{
 await harness(async({player,contexts,settle})=>{
  player.setVolume(.25);player.setMuted(false);
  assert.equal(player.audioState.volume,.25);assert.equal(player.audioState.muted,false);
  assert.equal(contexts.length,0);await player.play();await settle();
  assert.equal(player.audioState.volume,.25);player.setMuted(true);player.setVolume(.7);
  assert.equal(player.audioState.volume,.7);assert.equal(player.audioState.muted,true);
  player.setMuted(false);assert.equal(player.getDiagnostics().audio.volume,.7);
 });
});
