import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRenderer} from '../src/renderer.js';
import {quaternionMatrix,multiplyMatrix3,viewRotationMatrix} from '../src/quaternion.js';
const near=(a,b)=>a.forEach((x,i)=>assert.ok(Math.abs(x-b[i])<1e-6,`${i}: ${x} != ${b[i]}`));
test('renderer applies per-frame correction to shader and listener, preserving pan and resetting for other sources',()=>{
 const saved={requestAnimationFrame:globalThis.requestAnimationFrame,document:globalThis.document},events={},uniforms={};let next;
 const gl=new Proxy({getShaderParameter:()=>true,getProgramParameter:()=>true,getParameter:()=>8192,isContextLost:()=>false,getUniformLocation:(_p,name)=>name,uniformMatrix3fv:(name,_transpose,m)=>uniforms[name]=Array.from(m)}, {get:(target,key)=>key in target?target[key]:/^[A-Z_0-9]+$/.test(key)?1:()=>({})});
 const canvas={clientWidth:400,clientHeight:300,getContext:()=>gl,addEventListener:(name,cb)=>events[name]=cb,focus(){},setPointerCapture(){}};
 Object.assign(globalThis,{requestAnimationFrame:cb=>{next=cb;return 1;},document:{getElementById:()=>null}});
 try{
  const renderer=createRenderer(canvas);let orientation;
  const unsubscribe=renderer.onViewOrientation(matrix=>orientation=Array.from(matrix));const q=[Math.SQRT1_2,0,Math.SQRT1_2,0],frame={width:4096,height:1344};
  renderer.setMaxSources(frame,frame,{stabilization:q});next();near(uniforms.stabilization,quaternionMatrix(q));near(orientation,quaternionMatrix(q));
  events.keydown({key:'ArrowLeft',preventDefault(){}});next();near(orientation,multiplyMatrix3(quaternionMatrix(q),viewRotationMatrix(.1,0)));
  renderer.reset();renderer.setSource(null);next();near(uniforms.stabilization,quaternionMatrix([1,0,0,0]));near(orientation,quaternionMatrix([1,0,0,0]));
  const retained=orientation;unsubscribe();events.keydown({key:'ArrowLeft',preventDefault(){}});next();assert.equal(orientation,retained);
 }finally{Object.assign(globalThis,saved);}
});
test('XR view matrix preserves three-axis pose rotation before source stabilization',()=>{
 const pose=[0,1,0,0,-1,0,0,0,0,0,1,0,5,6,7,1];
 const rotation=viewRotationMatrix(0,99,pose);near(rotation,[0,1,0,-1,0,0,0,0,1]);
 // Headset translation and desktop pitch do not affect the immersive ray.
 near(viewRotationMatrix(.2,-99,pose),multiplyMatrix3(quaternionMatrix([Math.cos(.1),0,Math.sin(.1),0]),rotation));
});
test('active window/XR frame loop advances media before drawing without duplicate window ticks',async()=>{
 const keys=['requestAnimationFrame','document','navigator','XRWebGLLayer'];
 const saved=Object.fromEntries(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 const steps=[],canvasEvents={},sessionEvents={};let windowFrame,xrFrame;
 const gl=new Proxy({getShaderParameter:()=>true,getProgramParameter:()=>true,getParameter:()=>8192,isContextLost:()=>false,getUniformLocation:(_p,name)=>name,drawArrays:()=>steps.push('draw')},{get:(target,key)=>key in target?target[key]:/^[A-Z_0-9]+$/.test(key)?1:()=>({})});
 const canvas={clientWidth:400,clientHeight:300,getContext:()=>gl,addEventListener:(name,cb)=>canvasEvents[name]=cb,dispatchEvent(event){canvasEvents[event.type]?.(event);}};
 const session={renderState:{},async requestReferenceSpace(){return {};},updateRenderState(state){Object.assign(this.renderState,state);},addEventListener(name,cb){sessionEvents[name]=cb;},requestAnimationFrame(cb){xrFrame=cb;return 1;},async end(){sessionEvents.end?.();}};
 const globals={requestAnimationFrame:cb=>{windowFrame=cb;return 1;},document:{getElementById:()=>null},navigator:{xr:{async requestSession(){return session;}}},XRWebGLLayer:class{getViewport(){return {x:0,y:0,width:400,height:300};}}};
 for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
 try{
  const renderer=createRenderer(canvas),advance=[];
  const unsubscribe=renderer.onBeforeRender(time=>{advance.push(time);steps.push('advance');});
  windowFrame(10);assert.deepEqual(steps,['advance','draw']);steps.length=0;
  await renderer.enterVR();windowFrame(20);assert.deepEqual(advance,[10]);assert.equal(steps.length,0);
  const matrix=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
  const frame={getViewerPose(){return {transform:{matrix},views:[{projectionMatrix:matrix,transform:{matrix}},{projectionMatrix:matrix,transform:{matrix}}]};}};
  xrFrame(30,frame);assert.deepEqual(advance,[10,30]);assert.deepEqual(steps,['advance','draw','draw']);steps.length=0;
  xrFrame(40,frame);assert.deepEqual(advance,[10,30,40]);
  await renderer.enterVR();windowFrame(50);assert.deepEqual(advance,[10,30,40,50]);
  unsubscribe();windowFrame(60);assert.deepEqual(advance,[10,30,40,50]);
 }finally{for(const key of keys){if(saved[key])Object.defineProperty(globalThis,key,saved[key]);else delete globalThis[key];}}
});
