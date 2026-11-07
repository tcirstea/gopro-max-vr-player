import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRenderer} from '../src/renderer.js';
function harness(){
 const names=['requestAnimationFrame','document','window'],saved=Object.fromEntries(names.map(n=>[n,Object.getOwnPropertyDescriptor(globalThis,n)]));
 const events={},windowEvents={},docEvents={},uniforms={},captured=new Set();let draw,focused=0;
 const gl=new Proxy({getShaderParameter:()=>true,getProgramParameter:()=>true,getParameter:()=>8192,isContextLost:()=>false,getUniformLocation:(_p,n)=>n,uniform1f:(n,v)=>uniforms[n]=v},{get:(t,k)=>k in t?t[k]:/^[A-Z_0-9]+$/.test(k)?1:()=>({})});
 const canvas={clientWidth:400,clientHeight:300,getContext:()=>gl,addEventListener:(n,f)=>events[n]=f,focus(){focused++;},setPointerCapture:id=>captured.add(id),hasPointerCapture:id=>captured.has(id),releasePointerCapture:id=>captured.delete(id)};
 const doc={getElementById:()=>null,hidden:false,addEventListener:(n,f)=>docEvents[n]=f};
 Object.assign(globalThis,{requestAnimationFrame:f=>draw=f,document:doc,window:{addEventListener:(n,f)=>windowEvents[n]=f}});createRenderer(canvas);draw(0);
 function emit(type,extra={}){const e={pointerId:1,clientX:0,clientY:0,prevented:false,preventDefault(){this.prevented=true;},...extra};events[type](e);draw(0);return e;}
 return {emit,events,windowEvents,docEvents,doc,captured,uniforms,get focused(){return focused;},restore(){for(const n of names){if(saved[n])Object.defineProperty(globalThis,n,saved[n]);else delete globalThis[n];}}};
}
for(const button of [0,2])test(`${button===2?'right':'left'} drag rotates panorama with capture and leaves wheel/navigation keys working`,()=>{
 const h=harness();try{
  assert.ok(h.emit('pointerdown',{button}).prevented);assert.equal(h.focused,1);assert.ok(h.captured.has(1));
  h.emit('pointermove',{clientX:25,clientY:50,buttons:button===2?2:1});assert.equal(h.uniforms.yaw,.1);assert.equal(h.uniforms.pitch,.2);
  h.emit('pointerup');assert.equal(h.captured.size,0);h.emit('pointermove',{clientX:50,clientY:100});assert.equal(h.uniforms.yaw,.1);
  for(const key of ['ArrowLeft','ArrowRight',' '])assert.equal(h.emit('keydown',{key}).prevented,false);
  assert.equal(h.uniforms.yaw,.1);h.emit('keydown',{key:'ArrowUp'});assert.ok(h.uniforms.pitch>.2);
  h.emit('wheel',{deltaY:-10,timeStamp:0});assert.ok(h.uniforms.fov<Math.PI/2);
  assert.ok(h.emit('contextmenu').prevented);assert.equal(h.windowEvents.contextmenu,undefined);
 }finally{h.restore();}
});
test('unsupported buttons and competing pointers cannot start or hijack a drag',()=>{
 const h=harness();try{
  assert.equal(h.emit('pointerdown',{button:3}).prevented,false);assert.equal(h.focused,0);
  h.emit('pointerdown',{button:2});h.emit('pointerdown',{pointerId:2,button:0,clientX:999});h.emit('pointermove',{pointerId:2,clientX:500});h.emit('pointerup',{pointerId:2});assert.equal(h.uniforms.yaw,0);
  h.emit('pointermove',{clientX:25});assert.equal(h.uniforms.yaw,.1);assert.equal(h.focused,1);
 }finally{h.restore();}
});
test('cancel, lost capture, focus loss, hidden page and released buttons stop rotation',()=>{
 for(const reason of ['pointercancel','lostpointercapture','blur','window-blur','hidden','released']){
  const h=harness();try{
   h.emit('pointerdown',{button:2});h.emit('pointermove',{clientX:25,buttons:2});
   if(reason==='window-blur')h.windowEvents.blur();else if(reason==='hidden'){h.doc.hidden=true;h.docEvents.visibilitychange();}else if(reason==='released')h.emit('pointermove',{clientX:200,buttons:0});else h.emit(reason);
   h.emit('pointermove',{clientX:100,buttons:2});assert.equal(h.uniforms.yaw,.1,reason);assert.equal(h.captured.size,0,reason);
   h.doc.hidden=false;h.emit('pointerdown',{button:0,clientX:100});h.emit('pointermove',{clientX:125,buttons:1});assert.equal(h.uniforms.yaw,.2,reason);
  }finally{h.restore();}
 }
});

test('middle click resets zoom only, suppresses autoscroll and never starts a drag',()=>{
 const h=harness();try{
  h.emit('pointerdown',{button:2});h.emit('pointermove',{clientX:25,clientY:50,buttons:2});h.emit('pointerup');h.emit('wheel',{deltaY:-500,timeStamp:0});assert.notEqual(h.uniforms.fov,Math.PI/2);
  const {yaw,pitch}=h.uniforms;assert.ok(h.emit('pointerdown',{button:1}).prevented);assert.equal(h.uniforms.fov,Math.PI/2);assert.equal(h.uniforms.yaw,yaw);assert.equal(h.uniforms.pitch,pitch);assert.equal(h.captured.size,0);
  h.emit('pointermove',{clientX:100,clientY:100,buttons:4});assert.equal(h.uniforms.yaw,yaw);assert.equal(h.uniforms.pitch,pitch);
  assert.ok(h.emit('auxclick',{button:1}).prevented);assert.equal(h.emit('auxclick',{button:2}).prevented,false);
  h.emit('wheel',{deltaY:-10,timeStamp:10});assert.ok(h.uniforms.fov<Math.PI/2,'reset releases old zoom detents');
 }finally{h.restore();}
});
