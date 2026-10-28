import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createNativeAudio,pcm32ToPlanes} from '../src/native-audio.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function track({kind='pcm-s32le',mode=kind==='aac'?'stereo':'ambisonic',count=200,duration=count*.01,start=0,inputIndex=2}={}){return {kind,mode,inputIndex,channels:kind==='aac'?2:4,sampleRate:48000,duration,spatial:kind==='aac'?null:{order:1},config:{codec:'mp4a.40.2',sampleRate:48000,numberOfChannels:2},samples:Array.from({length:count},(_,i)=>({offset:i*7680,size:kind==='aac'?4:7680,timestamp:Math.round((start+i*.01)*1e6),duration:10000,frames:480,key:true}))};}
function movie(tracks=[track()],duration=2){const reads=[];return {audioTracks:tracks,duration,reads,async read(s,t,i){reads.push([t,i]);return new Uint8Array(s.size);}};}
async function harness(run,{supported=true,hold=false,configureError=false}={}){
 const keys=['AudioContext','webkitAudioContext','AudioDecoder','EncodedAudioChunk'],saved=Object.fromEntries(keys.map(k=>[k,globalThis[k]])),contexts=[],decoders=[],data=[];
 const param=()=>({value:0,setValueAtTime(value){this.value=value;}});
 class Node{constructor(type){this.type=type;this.connections=[];this.disconnects=0;this.gain=param();for(const k of ['position','forward','up'])for(const axis of ['X','Y','Z'])this[k+axis]=param();}connect(...args){this.connections.push(args);}disconnect(){this.disconnects++;}}
 class Context{constructor(){this.currentTime=0;this.state='suspended';this.nodes=[];this.buffers=[];this.sources=[];this.destination={};this.listener=new Node('listener');contexts.push(this);}node(type){const n=new Node(type);this.nodes.push(n);return n;}createGain(){return this.node('gain');}createChannelSplitter(){return this.node('splitter');}createPanner(){return this.node('panner');}createBuffer(channels,length,rate){const b={numberOfChannels:channels,length,sampleRate:rate,duration:length/rate,planes:Array.from({length:channels},()=>new Float32Array(length)),copyToChannel(p,c){this.planes[c].set(p);}};this.buffers.push(b);return b;}createBufferSource(){const n=this.node('source');n.start=(when,offset,duration)=>{n.when=when;n.offset=offset;n.duration=duration;};n.stop=()=>{n.stopped=true;};this.sources.push(n);return n;}async resume(){this.state='running';}async close(){this.state='closed';}advance(to){this.currentTime=to;for(const s of this.sources)if(!s.ended&&s.when+s.duration<=to){s.ended=true;s.onended?.();}}}
 class Decoder{static async isConfigSupported(){return {supported};}constructor(options){this.options=options;this.state='unconfigured';this.chunks=[];this.decodeQueueSize=0;decoders.push(this);}configure(){if(configureError)throw Error('configuration failure');this.state='configured';}decode(chunk){this.chunks.push(chunk);if(!hold)queueMicrotask(()=>this.emit(1));}emit(n=Infinity){for(const chunk of this.chunks.splice(0,n)){const out={numberOfChannels:2,numberOfFrames:480,sampleRate:48000,timestamp:chunk.timestamp,closed:false,copyTo(p){p.fill(.25);},close(){this.closed=true;}};data.push(out);this.options.output(out);}}async flush(){if(!hold)this.emit();}close(){this.state='closed';}}
 Object.assign(globalThis,{AudioContext:Context,webkitAudioContext:undefined,AudioDecoder:Decoder,EncodedAudioChunk:class{constructor(init){Object.assign(this,init);}}});
 const created=[];try{await run({contexts,decoders,data,async create(m=movie()){const a=await createNativeAudio(m);created.push(a);return a;}});}finally{created.forEach(a=>a.close());Object.assign(globalThis,saved);}
}
test('signed little-endian PCM conversion honors view offset and interleaved channel order',()=>{
 const backing=new Uint8Array(40),bytes=backing.subarray(4,36),v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);[-2147483648,0,1073741824,2147483647,1,-1,536870912,-536870912].forEach((n,i)=>v.setInt32(i*4,n,true));const p=pcm32ToPlanes(bytes,4,2);near(p[0][0],-1);near(p[2][0],.5);near(p[3][1],-.25);assert.throws(()=>pcm32ToPlanes(bytes.subarray(1),4,2),/Truncated/);
});
test('timestamp scheduling is bounded by available video and master clock freezes through RAF drought',async()=>harness(async({create,contexts})=>{
 const a=await create();await a.unlock();await settle();const c=contexts[0];a.schedule(0,.08);near(a.getDiagnostics().scheduledEnd,.08);assert.ok(c.sources.every(s=>s.when+s.duration<=.100001));
 c.advance(.06);near(a.clock(),.04);c.advance(10);near(a.clock(),.08);a.schedule(a.clock(),.2);near(a.clock(),.08);assert.equal(a.getDiagnostics().underruns,1);assert.ok(c.sources.at(-1).when>=10.02);c.advance(10.04);near(a.clock(),.1);
}));
test('pause/resume reschedules exact retained buffer offset without replaying prior audio',async()=>harness(async({create,contexts})=>{
 const a=await create();await a.unlock();await settle();const c=contexts[0];a.schedule(0,.15);c.advance(.045);near(a.pause(),.025);assert.ok(c.sources.every(s=>s.stopped||s.ended));const before=c.sources.length;c.advance(2);near(a.clock(),.025);a.schedule(.025,.1);const first=c.sources[before];near(first.offset,.005);near(first.when,2.02);near(first.duration,.005);
}));
test('mute and unmute change output gain without changing the media clock',async()=>harness(async({create,contexts})=>{
 const a=await create();await a.unlock();await settle();const c=contexts[0];a.schedule(0,.15);c.advance(.07);const before=a.clock();a.setMuted(false);assert.equal(a.state.muted,false);near(a.clock(),before);a.setMuted(true);near(a.clock(),before);assert.equal(c.nodes[0].gain.value,0);
}));
test('short audio ends in timeline silence and edited duration clips actual sources',async()=>harness(async({create,contexts})=>{
 const a=await create(movie([track({count:10,duration:.035})],.2));await a.unlock();await settle();const c=contexts[0];a.schedule(0,.15);assert.ok(c.sources.every(s=>s.when+s.duration<=.055001),'audio may not leak past edit duration');near(a.getDiagnostics().scheduledEnd,.15);c.advance(.17);near(a.clock(),.15);a.schedule(.15,.2);c.advance(.24);near(a.clock(),.2);
}));
test('audio-free leading time advances as silence without starting samples early',async()=>harness(async({create,contexts})=>{
 const a=await create(movie([track({count:10,start:.1,duration:.2})],.3));await a.unlock();await settle();a.schedule(0,.05);assert.equal(contexts[0].sources.length,0);near(a.getDiagnostics().scheduledEnd,.05);contexts[0].advance(.07);a.schedule(.05,.15);assert.ok(contexts[0].sources.every(s=>s.when>=.12));
}));
test('seek discards stale file reads and does not let a closed old pump block the new generation',async()=>harness(async({create,contexts})=>{
 const m=movie(),pending=[];m.read=(sample,track,index)=>new Promise(resolve=>pending.push({sample,index,resolve}));const a=await create(m);await a.unlock();assert.equal(pending.length,1);a.seek(.5);assert.equal(pending.length,2);pending[0].resolve(new Uint8Array(pending[0].sample.size));await settle();assert.equal(contexts[0].buffers.length,0);pending[1].resolve(new Uint8Array(pending[1].sample.size));await settle();assert.equal(contexts[0].buffers.length,1);assert.equal(a.getDiagnostics().decodedPackets,1);a.close();const tail=pending.at(-1);tail.resolve(new Uint8Array(tail.sample.size));await settle();assert.equal(contexts[0].buffers.length,1);
}));
test('AAC retains <=24 outstanding packets; stale output after seek is closed, never enqueued',async()=>harness(async({create,decoders,data})=>{
 const a=await create(movie([track({kind:'aac'})]));await a.unlock();await settle();assert.equal(decoders[0].chunks.length,24);assert.equal(a.getDiagnostics().maxPending,24);a.seek(.5);await settle();decoders[0].emit();assert.ok(data.every(d=>d.closed));assert.equal(a.getDiagnostics().queuedBuffers,0);decoders[1].emit(4);await settle();assert.ok(a.getDiagnostics().queuedBuffers>0);assert.ok(data.every(d=>d.closed));
},{hold:true}));
test('unavailable AAC falls back to metadata-verified PCM or a nonblocking silent video path',async()=>harness(async({create})=>{
 const fallback=await create(movie([track({kind:'aac'}),track()]));assert.equal(fallback.state.mode,'ambisonic');assert.equal(fallback.available,true);const absent=await create(movie([track({kind:'aac'})]));assert.equal(absent.available,false);near(absent.readyEnd(),2);await absent.unlock();assert.equal(absent.ready,false);
},{supported:false}));
test('mode switching cancels old sources/decoder and re-seeks on the same context',async()=>harness(async({create,contexts,decoders})=>{
 const a=await create(movie([track({kind:'aac'}),track({inputIndex:3})]));assert.equal(a.state.mode,'stereo');await a.unlock();await settle();a.schedule(0,.15);const old=contexts[0].sources.slice();assert.equal(a.select('ambisonic',.5),true);await settle();assert.equal(contexts.length,1);assert.equal(decoders[0].state,'closed');assert.ok(old.every(s=>s.stopped));assert.equal(a.state.mode,'ambisonic');near(a.clock(),.5);assert.equal(a.select('unknown',.5),false);a.select('stereo',.6);await settle();assert.equal(a.state.mode,'stereo');assert.equal(decoders.length,2);
}));
test('failed decoder configuration releases partial state and closes with no resurrection',async()=>harness(async({create,decoders,contexts})=>{
 const a=await create(movie([track({kind:'aac'})]));await assert.rejects(a.unlock(),/Audio could not start/);assert.equal(a.available,false);assert.equal(decoders[0].state,'closed');a.close();a.seek(0);await a.unlock();assert.equal(contexts[0].state,'closed');assert.equal(decoders.length,1);
},{configureError:true}));
test('decoder error and repeated closure stop scheduled sources and reject new scheduling',async()=>harness(async({create,contexts,decoders})=>{
 const a=await create(movie([track({kind:'aac'})]));await a.unlock();await settle();a.schedule(0,.15);decoders[0].options.error(new Error('decode error'));assert.equal(a.available,false);assert.ok(contexts[0].sources.every(s=>s.stopped));assert.equal(a.getDiagnostics().queuedBuffers,0);a.close();a.close();a.schedule(.1,.2);assert.equal(contexts[0].state,'closed');
}));
test('sustained PCM scheduling advances through completion with bounded queues and live sources',async()=>harness(async({create,contexts})=>{
 const a=await create();await a.unlock();await settle();const c=contexts[0];let at=0,maxLive=0;
 for(let step=0;step<160;step++){a.schedule(at,Math.min(2,at+.2));await settle();c.advance(c.currentTime+.016);at=a.clock();maxLive=Math.max(maxLive,c.sources.filter(s=>!s.ended&&!s.stopped).length);assert.ok(a.getDiagnostics().queuedBuffers<=64);}
 near(at,2);assert.ok(maxLive<40);assert.ok(a.getDiagnostics().maxQueuedBuffers<=64);
}));
test('short edited tracks never schedule beyond trim even when trimmed decoded packets remain queued',async()=>harness(async({create,contexts})=>{
 const a=await create(movie([track({kind:'aac',count:10,duration:.035})],.2));await a.unlock();await settle();const c=contexts[0];a.schedule(0,.15);assert.ok(c.sources.every(s=>s.when+s.duration<=.055001));c.advance(.17);a.schedule(.15,.2);assert.ok(c.sources.every(s=>s.when+s.duration<=.055001));
}));
test('AudioContext suspension freezes at its actual media instant instead of rewinding to last schedule',async()=>harness(async({create,contexts})=>{
 const a=await create();await a.unlock();await settle();const c=contexts[0];a.schedule(0,.15);c.advance(.07);near(a.clock(),.05);c.state='suspended';near(a.clock(),.05);assert.equal(a.ready,false);c.state='running';near(a.clock(),.05);
}));
