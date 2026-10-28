import {test} from 'node:test';
import assert from 'node:assert/strict';
import {VIRTUAL_SPEAKERS,SPATIAL_HEADROOM,listenerOrientation,createSpatialAudio} from '../src/spatial-audio.js';
const approx=(actual,expected)=>{assert.equal(actual.length,expected.length);actual.forEach((v,i)=>assert.ok(Math.abs(v-expected[i])<1e-8,`${v} != ${expected[i]}`));};
test('ACN/SN3D cube decode maps front, left and up to viewer axes without channel swapping',()=>{
 assert.equal(VIRTUAL_SPEAKERS.length,8);
 for(const [channel,axis]of [[3,[0,0,-1]],[1,[-1,0,0]],[2,[0,1,0]]]){
  const centroid=[0,0,0];for(const s of VIRTUAL_SPEAKERS)for(let i=0;i<3;i++)centroid[i]+=s.gains[channel]*s.position[i];
  approx(centroid,axis.map(x=>x*SPATIAL_HEADROOM/Math.sqrt(3)));
 }
 approx(VIRTUAL_SPEAKERS.reduce((sum,s)=>sum.map((v,i)=>v+s.gains[i]),[0,0,0,0]),[SPATIAL_HEADROOM,0,0,0]);
 assert.ok(VIRTUAL_SPEAKERS.reduce((sum,s)=>sum+s.gains.reduce((a,v)=>a+Math.abs(v),0),0)<=1);
});
test('identity, yaw, pitch and roll listener axes follow camera-to-source columns',()=>{
 assert.deepEqual(listenerOrientation(),{forward:[0,0,-1],up:[0,1,0]});
 assert.deepEqual(listenerOrientation([0,0,-1,0,1,0,1,0,0]),{forward:[-1,0,0],up:[0,1,0]});
 assert.deepEqual(listenerOrientation([1,0,0,0,0,1,0,-1,0]),{forward:[0,1,0],up:[0,0,1]});
 assert.deepEqual(listenerOrientation([0,1,0,-1,0,0,0,0,1]),{forward:[0,0,-1],up:[-1,0,0]});
});
test('nonfinite, scaled, sheared and mirrored orientation matrices are rejected',()=>{
 for(const matrix of [[],[NaN,0,0,0,1,0,0,0,1],[2,0,0,0,1,0,0,0,1],[1,0,0,1,1,0,0,0,1],[-1,0,0,0,1,0,0,0,1]])assert.throws(()=>listenerOrientation(matrix),/rotation/);
});
function fakeContext({legacy=false,failAt=Infinity}={}){
 const nodes=[];const parameter=()=>({value:0,events:[],setValueAtTime(value,time){this.value=value;this.events.push([value,time]);}});
 const spatial=()=>legacy?{setPosition(...v){this.position=v;},setOrientation(...v){this.orientation=v;}}:Object.fromEntries(['positionX','positionY','positionZ','forwardX','forwardY','forwardZ','upX','upY','upZ'].map(k=>[k,parameter()]));
 const create=type=>{if(nodes.length===failAt)throw Error('allocation failed');const node={type,connections:[],disconnects:0,gain:parameter(),...spatial(),connect(...args){this.connections.push(args);},disconnect(){this.disconnects++;}};nodes.push(node);return node;};
 return {nodes,currentTime:7,destination:{},listener:spatial(),createGain:()=>create('gain'),createPanner:()=>create('panner'),createChannelSplitter:n=>{const node=create('splitter');node.outputs=n;return node;}};
}
test('graph preserves four discrete channels and routes 8 mono HRTF panners to destination',()=>{
 const c=fakeContext(),output={},audio=createSpatialAudio(c,output),panners=c.nodes.filter(n=>n.type==='panner'),splitter=c.nodes.find(n=>n.type==='splitter');
 assert.equal(audio.input.channelCount,4);assert.equal(audio.input.channelInterpretation,'discrete');assert.equal(splitter.outputs,4);assert.equal(splitter.connections.length,32);assert.equal(panners.length,8);
 for(const p of panners){assert.equal(p.panningModel,'HRTF');assert.equal(p.rolloffFactor,0);assert.equal(p.channelCount,1);assert.equal(p.connections[0][0],output);}
 for(let i=0;i<32;i++)assert.equal(splitter.connections[i][1],i%4);
 audio.setViewRotation([0,0,-1,0,1,0,1,0,0]);assert.equal(c.listener.forwardX.value,-1);assert.equal(c.listener.forwardZ.value,0);assert.equal(c.listener.upY.value,1);
 audio.close();audio.close();assert.ok(c.nodes.every(n=>n.disconnects===1));audio.setViewRotation([]);
});
test('legacy orientation APIs are supported and partial construction failures disconnect nodes',()=>{
 const c=fakeContext({legacy:true}),audio=createSpatialAudio(c);assert.deepEqual(c.listener.orientation,[0,0,-1,0,1,0]);assert.deepEqual(c.listener.position,[0,0,0]);audio.close();
 const failed=fakeContext({failAt:8});assert.throws(()=>createSpatialAudio(failed),/allocation failed/);assert.ok(failed.nodes.every(n=>n.disconnects===1));
});
