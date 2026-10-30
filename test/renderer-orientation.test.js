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
test('XR controller zoom reaches shader FOV and transport events while desktop wheel stays equivalent',async()=>{
 const keys=['requestAnimationFrame','document','navigator','XRWebGLLayer'];
 const saved=Object.fromEntries(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 const events={},sessionEvents={},uniforms={},dispatched=[];let windowFrame,xrFrame,fragment;
 const gl=new Proxy({getShaderParameter:()=>true,getProgramParameter:()=>true,getParameter:()=>8192,isContextLost:()=>false,getUniformLocation:(_p,name)=>name,uniform1f:(name,value)=>uniforms[name]=value,shaderSource:(_s,source)=>{if(source.includes('eyeRay'))fragment=source;}},{get:(target,key)=>key in target?target[key]:/^[A-Z_0-9]+$/.test(key)?1:()=>({})});
 const canvas={clientWidth:400,clientHeight:300,getContext:()=>gl,addEventListener:(name,cb)=>events[name]=cb,dispatchEvent(event){dispatched.push(event);events[event.type]?.(event);}};
 const input={handedness:'right',gamepad:{mapping:'xr-standard',axes:[0,0,0,0],buttons:Array.from({length:5},()=>({pressed:false}))}};
 const session={visibilityState:'visible',inputSources:[input],renderState:{},async requestReferenceSpace(){return {};},updateRenderState(state){Object.assign(this.renderState,state);},addEventListener(name,cb){sessionEvents[name]=cb;},requestAnimationFrame(cb){xrFrame=cb;return 1;},async end(){sessionEvents.end?.();}};
 const globals={requestAnimationFrame:cb=>{windowFrame=cb;return 1;},document:{getElementById:()=>null},navigator:{xr:{async requestSession(){return session;}}},XRWebGLLayer:class{getViewport(){return {x:0,y:0,width:400,height:300};}}};
 for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
 try{
  const renderer=createRenderer(canvas);const matrix=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
  const frame={getViewerPose:()=>({transform:{matrix},views:[{projectionMatrix:matrix,transform:{matrix}}]})};
  events.wheel({deltaY:-12,preventDefault(){}});windowFrame(0);const wheelFov=uniforms.fov;
  renderer.reset();await renderer.enterVR();xrFrame(0,frame);input.gamepad.axes[3]=-1;xrFrame(20,frame);
  assert.equal(uniforms.fov,wheelFov);assert.match(fragment,/eyeRay\.xy\*=tan\(fov\/2\.\)/);
  input.gamepad.axes=[0,0,1,0];xrFrame(30,frame);assert.equal(dispatched.at(-1).type,'xrseek');assert.equal(dispatched.at(-1).detail,5);
  input.gamepad.buttons[4].pressed=true;xrFrame(40,frame);assert.equal(dispatched.at(-1).type,'xrtoggleplay');
  await renderer.enterVR();const count=dispatched.length;windowFrame(50);assert.equal(dispatched.length,count);
  await renderer.enterVR();xrFrame(60,frame);assert.equal(dispatched.filter(e=>e.type==='xrtoggleplay').length,1,'held button does not toggle on reentry');
 }finally{for(const key of keys){if(saved[key])Object.defineProperty(globalThis,key,saved[key]);else delete globalThis[key];}}
});
test('stick recenter neutralizes full pose, resets zoom, and aligns relative visual/audio rotations',async()=>{
 const keys=['requestAnimationFrame','document','navigator','XRWebGLLayer'];
 const saved=Object.fromEntries(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 const events={},sessionEvents={},uniforms={};let xrFrame,windowFrame,orientation;
 const gl=new Proxy({getShaderParameter:()=>true,getProgramParameter:()=>true,getParameter:()=>8192,isContextLost:()=>false,getUniformLocation:(_p,name)=>name,uniform1f:(name,value)=>uniforms[name]=value,uniformMatrix3fv:(name,_transpose,value)=>uniforms[name]=Array.from(value)},{get:(target,key)=>key in target?target[key]:/^[A-Z_0-9]+$/.test(key)?1:()=>({})});
 const canvas={clientWidth:400,clientHeight:300,getContext:()=>gl,addEventListener:(name,cb)=>events[name]=cb,dispatchEvent(event){events[event.type]?.(event);}};
 const input={handedness:'right',gamepad:{mapping:'xr-standard',axes:[0,0,0,0],buttons:Array.from({length:5},()=>({pressed:false}))}};
 const session={visibilityState:'visible',inputSources:[input],renderState:{},async requestReferenceSpace(){return {};},updateRenderState(state){Object.assign(this.renderState,state);},addEventListener(name,cb){sessionEvents[name]=cb;},requestAnimationFrame(cb){xrFrame=cb;return 1;},async end(){sessionEvents.end?.();}};
 const globals={requestAnimationFrame:cb=>{windowFrame=cb;return 1;},document:{getElementById:()=>null},navigator:{xr:{async requestSession(){return session;}}},XRWebGLLayer:class{getViewport(){return {x:0,y:0,width:400,height:300};}}};
 for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
 const identity=[1,0,0,0,1,0,0,0,1];
 const poseFor=r=>[r[0],r[1],r[2],0,r[3],r[4],r[5],0,r[6],r[7],r[8],0,5,6,7,1];
 const matrix=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];let pose=poseFor(quaternionMatrix([.5,.5,.5,.5]));
 const frame={getViewerPose:()=>pose?{transform:{matrix:pose},views:[{projectionMatrix:matrix,transform:{matrix:pose}}]}:null};
 try{
  const renderer=createRenderer(canvas);renderer.onViewOrientation(r=>orientation=Array.from(r));
  events.keydown({key:'ArrowLeft',preventDefault(){}});events.wheel({deltaY:-300,preventDefault(){}});
  await renderer.enterVR();xrFrame(0,frame);assert.notEqual(uniforms.fov,Math.PI/2);
  // Tracking loss defers the click until a pose is available.
  const original=pose;pose=null;input.gamepad.buttons[3].pressed=true;xrFrame(20,frame);assert.notEqual(uniforms.fov,Math.PI/2);
  pose=original;xrFrame(40,frame);assert.equal(uniforms.fov,Math.PI/2);assert.equal(uniforms.yaw,0);assert.equal(uniforms.pitch,0);near(orientation,identity);
  near(multiplyMatrix3(uniforms.xrCenter,viewRotationMatrix(0,0,pose)),identity);
  const anchor=uniforms.xrCenter.slice();
  const relative=quaternionMatrix([Math.cos(.2),0,Math.sin(.2),0]);pose=poseFor(multiplyMatrix3(viewRotationMatrix(0,0,original),relative));
  xrFrame(60,frame);near(orientation,relative);near(uniforms.xrCenter,anchor);
  // Stabilization is applied after the same recentered viewing transform used visually.
  const correction=quaternionMatrix([Math.cos(.1),Math.sin(.1),0,0]);const maxFrame={width:4096,height:1344};renderer.setMaxSources(maxFrame,maxFrame,{stabilization:[Math.cos(.1),Math.sin(.1),0,0]});xrFrame(80,frame);
  near(orientation,multiplyMatrix3(correction,multiplyMatrix3(uniforms.xrCenter,viewRotationMatrix(0,0,pose))));
  // Source switches keep view preferences, while source-specific stabilization resets.
  events.wheel({deltaY:-200,preventDefault(){}});xrFrame(90,frame);const retainedFov=uniforms.fov,retainedCenter=uniforms.xrCenter.slice();
  renderer.setSource(null);xrFrame(92,frame);assert.equal(uniforms.fov,retainedFov);near(uniforms.xrCenter,retainedCenter);near(orientation,relative);
  renderer.setMaxSources(maxFrame,maxFrame);xrFrame(94,frame);assert.equal(uniforms.fov,retainedFov);near(uniforms.xrCenter,retainedCenter);near(orientation,relative);
  renderer.reset();xrFrame(96,frame);assert.equal(uniforms.fov,Math.PI/2);near(orientation,identity);
  await renderer.enterVR();windowFrame(100);near(uniforms.xrCenter,identity);
  renderer.setSource(null);await renderer.enterVR();xrFrame(120,frame);near(uniforms.xrCenter,identity);near(orientation,viewRotationMatrix(0,0,pose));
  input.gamepad.buttons[3].pressed=false;xrFrame(140,frame);input.gamepad.buttons[3].pressed=true;xrFrame(160,frame);near(orientation,identity);
 }finally{for(const key of keys){if(saved[key])Object.defineProperty(globalThis,key,saved[key]);else delete globalThis[key];}}
});
