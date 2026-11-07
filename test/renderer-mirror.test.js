import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createZoomDetents} from '../src/zoom.js';
import {createXRViewDrag} from '../src/xr-view-drag.js';
import {createXRControls} from '../src/xr-controls.js';
import {maxLayout,MAX_GLSL} from '../src/max-projection.js';
import * as quaternions from '../src/quaternion.js';
import {mirrorViewport,invert4} from '../src/renderer.js';
const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
function harness(){
 let windowFrame,xrFrame,framebuffer=null,viewport=[0,0,1,1],lost=false,failMirror=false,advances=0,uploads=0,panelUpdates=0;
 const draws=[],clears=[],panelDraws=[],events=[],canvasEvents={},sessionEvents={},documentEvents={},uniforms={},bindings=[];
 const gl=new Proxy({
  getShaderParameter:()=>true,getProgramParameter:()=>true,isContextLost:()=>lost,
  getUniformLocation:(_p,n)=>n,
  uniform1f:(n,v)=>uniforms[n]=v,
  uniformMatrix3fv:(n,_t,v)=>uniforms[n]=Array.from(v),
  uniformMatrix4fv:(n,_t,v)=>uniforms[n]=Array.from(v),
  getParameter:n=>n==='FRAMEBUFFER_BINDING'?framebuffer:n==='MAX_TEXTURE_SIZE'?8192:null,
  bindFramebuffer:(_target,value)=>{framebuffer=value;bindings.push(value);},
  viewport:(...v)=>viewport=v,
  drawArrays:()=>{if(failMirror&&framebuffer===null)throw Error('synthetic mirror draw failure');draws.push({framebuffer,viewport:[...viewport],uniforms:structuredClone(uniforms)});},
  clear:()=>clears.push({framebuffer,viewport:[...viewport]}),
  texImage2D:()=>uploads++
 },{get:(obj,key)=>key in obj?obj[key]:/^[A-Z_0-9]+$/.test(key)?key:()=>({})});
 const canvas={width:800,height:500,clientWidth:800,clientHeight:500,getContext:()=>gl,focus(){},setPointerCapture(){},addEventListener:(n,f)=>canvasEvents[n]=f,dispatchEvent:e=>events.push(e)};
 const input={handedness:'right',gripSpace:{},gamepad:{mapping:'xr-standard',axes:[0,0,0,0],buttons:Array.from({length:6},()=>({pressed:false}))}};
 const session={visibilityState:'visible',inputSources:[input],renderState:{},async requestReferenceSpace(){return {};},updateRenderState(s){Object.assign(this.renderState,s);},addEventListener:(n,f)=>sessionEvents[n]=f,requestAnimationFrame:f=>xrFrame=f,async end(){sessionEvents.end?.();}};
 const document={hidden:false,getElementById:()=>null,addEventListener:(n,f)=>documentEvents[n]=f};
 const leftProjection=[1.2,0,0,0,0,1.5,0,0,.15,-.07,-1.02,-1,0,0,-.202,0];
 const leftMatrix=[0,1,0,0,-1,0,0,0,0,0,1,0,-.032,1.6,.3,1];
 const rightMatrix=[...identity];rightMatrix[12]=.032;
 const views=[{eye:'right',projectionMatrix:identity,transform:{matrix:rightMatrix,inverse:{matrix:identity}}},{eye:'left',projectionMatrix:leftProjection,transform:{matrix:leftMatrix,inverse:{matrix:identity}}}];
 let pose={transform:{matrix:identity},views},controller=identity;
 const frame={session,getViewerPose:()=>pose,getPose:()=>({transform:{matrix:controller}})};
 const context=vm.createContext({createZoomDetents,createXRViewDrag,createXRControls,maxLayout,MAX_GLSL,...quaternions,Event,CustomEvent,Promise,performance,document,navigator:{xr:{requestSession:async()=>session}},requestAnimationFrame:f=>windowFrame=f,devicePixelRatio:1,XRWebGLLayer:class{framebuffer='XR';getViewport(view){return {x:view.eye==='right'?400:0,y:0,width:400,height:400};}},createXRPanel:()=>({show(){},toggle(){},reset(){},update(){panelUpdates++;},draw(view){panelDraws.push({view,framebuffer,viewport:[...viewport]});}})});
 vm.runInContext(readFileSync(new URL('../src/renderer.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,''),context);
 const renderer=context.createRenderer(canvas);renderer.onBeforeRender(()=>advances++);
 const initialUploads=uploads;
 return {renderer,canvas,canvasEvents,document,documentEvents,session,sessionEvents,input,views,frame,draws,clears,panelDraws,events,uniforms,bindings,
  tick:(time=0)=>xrFrame(time,frame),windowTick:()=>windowFrame(0),setPose:value=>pose=value,setController:value=>controller=value,
  get pose(){return pose;},get advances(){return advances;},get uploads(){return uploads-initialUploads;},get framebuffer(){return framebuffer;},get viewport(){return viewport;},get panelUpdates(){return panelUpdates;},set lost(v){lost=v;},set failMirror(v){failMirror=v;}
 };
}
test('mirror is opt-in; disabled XR has only eye draws and no default framebuffer/resizing work',async()=>{
 const h=harness();await h.renderer.enterVR();h.tick();h.windowTick();
 assert.equal(h.advances,1);assert.equal(h.draws.length,2);assert.ok(h.draws.every(d=>d.framebuffer==='XR'));
 assert.ok(h.bindings.every(b=>b==='XR'));assert.equal(h.canvas.width,800);assert.equal(h.canvas.height,500);
 assert.equal(h.events.length,0);assert.equal(h.uploads,0);
});
test('mirror matches left-eye asymmetric projection, zoom, orientation and stabilization using existing uploads',async()=>{
 const h=harness(),max={width:4096,height:1344};
 h.renderer.setMaxSources(max,max,{stabilization:[Math.SQRT1_2,Math.SQRT1_2,0,0]});
 h.canvasEvents.wheel({deltaY:-150,timeStamp:0,preventDefault(){}});
 h.renderer.setDesktopMirror(true);await h.renderer.enterVR();h.tick();h.windowTick();
 assert.equal(h.advances,1);assert.equal(h.uploads,2);assert.equal(h.draws.length,3);
 const eye=h.draws[1],mirror=h.draws[2];assert.equal(mirror.framebuffer,null);
 assert.deepEqual(mirror.uniforms,eye.uniforms);
 assert.deepEqual(mirror.uniforms.invProjection,Array.from(invert4(h.views[1].projectionMatrix)));
 assert.deepEqual(mirror.uniforms.viewRotation,h.views[1].transform.matrix);assert.equal(mirror.uniforms.mode,1);assert.equal(mirror.uniforms.xr,1);
 assert.notEqual(mirror.uniforms.fov,Math.PI/2);assert.deepEqual(mirror.viewport,[150,0,500,500]);
 assert.equal(h.framebuffer,'XR');assert.deepEqual(h.viewport,eye.viewport);
 h.renderer.setSource({tagName:'VIDEO',paused:false,readyState:3});h.tick(20);
 assert.equal(h.uploads,3,'equirectangular texture uploaded once, not per eye/mirror');assert.equal(h.advances,2);
 const next=h.draws.slice(-3);assert.equal(next[2].uniforms.mode,0);assert.deepEqual(next[2].uniforms,next[1].uniforms);
});
test('the mirrored panel is drawn for the same eye without extra input/state updates',async()=>{
 const h=harness();h.renderer.setDesktopMirror(true);await h.renderer.enterVR();h.tick(0);
 h.input.gamepad.buttons[5].pressed=true;h.tick(20);
 assert.equal(h.panelUpdates,1);assert.equal(h.panelDraws.length,3);
 assert.deepEqual(h.panelDraws.map(d=>d.view),[h.views[0],h.views[1],h.views[1]]);
 assert.deepEqual(h.panelDraws.map(d=>d.framebuffer),['XR','XR',null]);
 assert.deepEqual(h.panelDraws[2].viewport,[150,0,500,500]);assert.equal(h.advances,2);
});
test('mirror preserves recenter, grip corrections and zoom resets frame by frame',async()=>{
 const h=harness();h.renderer.setDesktopMirror(true);await h.renderer.enterVR();h.tick(0);
 h.input.gamepad.buttons[1].pressed=true;h.tick(20);
 h.setController([0,1,0,0,-1,0,0,0,0,0,1,0,0,0,0,1]);h.tick(40);
 const corrected=h.draws.at(-1).uniforms.xrCenter;assert.notDeepEqual(corrected,[1,0,0,0,1,0,0,0,1]);
 assert.deepEqual(h.draws.at(-1).uniforms,h.draws.at(-2).uniforms);
 h.renderer.reset();h.tick(60);assert.equal(h.draws.at(-1).uniforms.fov,Math.PI/2);assert.deepEqual(h.draws.at(-1).uniforms,h.draws.at(-2).uniforms);
 h.input.gamepad.buttons[3].pressed=true;h.tick(80);assert.deepEqual(h.draws.at(-1).uniforms,h.draws.at(-2).uniforms);
});
test('disabling clears the last mirrored frame once, restores framebuffer and stops extra draws',async()=>{
 const h=harness();await h.renderer.enterVR();h.renderer.setDesktopMirror(true);h.tick();
 const n=h.clears.length;h.renderer.setDesktopMirror(false);
 assert.equal(h.clears.length,n+1);assert.equal(h.clears.at(-1).framebuffer,null);assert.equal(h.framebuffer,'XR');
 h.renderer.setDesktopMirror(false);assert.equal(h.clears.length,n+1);
 h.tick(20);assert.deepEqual(h.draws.slice(-2).map(d=>d.framebuffer),['XR','XR']);assert.equal(h.draws.length,5);
 assert.equal(h.events.at(-1).detail.enabled,false);assert.equal(h.events.at(-1).detail.active,false);
 h.renderer.setDesktopMirror(true);h.tick(40);assert.equal(h.draws.at(-1).framebuffer,null);
});
test('missing tracking and interrupted visibility clear stale mirror and recover without a second playback loop',async()=>{
 const h=harness();h.renderer.setDesktopMirror(true);await h.renderer.enterVR();h.tick();const pose=h.pose;
 h.setPose(null);h.tick(20);assert.equal(h.clears.at(-1).framebuffer,null);assert.equal(h.advances,1);assert.equal(h.draws.length,3);
 h.setPose(pose);h.tick(40);assert.equal(h.draws.length,6);
 h.session.visibilityState='visible-blurred';h.sessionEvents.visibilitychange();assert.equal(h.clears.at(-1).framebuffer,null);
 h.tick(60);assert.equal(h.draws.length,8);
 h.session.visibilityState='visible';h.tick(80);assert.equal(h.draws.length,11);
 h.document.hidden=true;h.documentEvents.visibilitychange();assert.equal(h.clears.at(-1).framebuffer,null);
 h.tick(100);assert.equal(h.draws.length,13);h.document.hidden=false;h.tick(120);assert.equal(h.draws.length,16);
});
test('empty views and zero-size canvas skip mirror safely; first mono view is supported',async()=>{
 const h=harness();h.renderer.setDesktopMirror(true);await h.renderer.enterVR();h.tick();
 h.setPose({transform:{matrix:identity},views:[]});h.tick(20);assert.equal(h.draws.length,3);assert.equal(h.clears.at(-1).framebuffer,null);
 h.setPose({transform:{matrix:identity},views:[{...h.views[0],eye:'none'}]});h.tick(40);assert.equal(h.draws.length,5);assert.deepEqual(h.draws[3].uniforms,h.draws[4].uniforms);
 h.canvas.clientWidth=0;h.tick(60);assert.equal(h.draws.length,6);assert.equal(h.clears.at(-1).framebuffer,null);
});
test('mirror cap and aspect adapt to resize; exit restores ordinary desktop sizing and retained angles',async()=>{
 const h=harness();h.canvasEvents.pointerdown({pointerId:1,button:2,clientX:0,clientY:0});h.canvasEvents.pointermove({pointerId:1,buttons:2,clientX:100,clientY:0});h.canvasEvents.pointerup({pointerId:1});
 h.renderer.setDesktopMirror(true);await h.renderer.enterVR();h.canvas.clientWidth=3840;h.canvas.clientHeight=2160;h.tick();
 assert.equal(h.canvas.width,1280);assert.equal(h.canvas.height,720);assert.deepEqual(h.draws.at(-1).viewport,[280,0,720,720]);
 h.canvas.clientWidth=600;h.canvas.clientHeight=1000;h.tick(20);assert.deepEqual(h.draws.at(-1).viewport,[0,200,600,600]);
 h.frame.getViewerPose=()=>{throw Error('must ignore stale session');};
 // The old session callback also becomes inert after end.
 await h.renderer.enterVR();h.tick(30);h.windowTick();assert.equal(h.draws.at(-1).uniforms.xr,0);assert.equal(h.draws.at(-1).uniforms.roll,.4);
 assert.equal(h.canvas.width,600);assert.equal(h.canvas.height,1000);assert.equal(h.events.at(-1).type,'vrend');
 h.frame.getViewerPose=()=>h.pose;await h.renderer.enterVR();h.tick(40);assert.equal(h.draws.at(-1).uniforms.xr,1);assert.equal(h.draws.at(-1).framebuffer,null);
});
test('mirror error disables only mirror and restores XR framebuffer and viewport for later frames',async()=>{
 const h=harness();h.renderer.setDesktopMirror(true);await h.renderer.enterVR();h.failMirror=true;h.tick();
 assert.equal(h.draws.length,2);assert.equal(h.framebuffer,'XR');assert.deepEqual(h.viewport,[0,0,400,400]);
 assert.equal(h.events.at(-1).type,'xrmirrorerror');assert.equal(h.events.at(-2).detail.enabled,false);
 h.failMirror=false;h.tick(20);assert.equal(h.draws.length,4);assert.equal(h.advances,2);
 h.renderer.setDesktopMirror(true);h.tick(40);assert.equal(h.draws.length,7);
});
test('lost graphics context skips XR uploads, draws and mirror clearing until page reload',async()=>{
 const h=harness();h.renderer.setDesktopMirror(true);await h.renderer.enterVR();h.tick();
 const n=h.clears.length;h.lost=true;h.tick(20);h.renderer.setDesktopMirror(false);h.windowTick();
 assert.equal(h.draws.length,3);assert.equal(h.advances,1);assert.equal(h.clears.length,n);
});
test('letterboxing fits wide/tall monitor and asymmetric eye sizes without crop',()=>{
 assert.deepEqual(mirrorViewport(1600,900,{width:1000,height:1000}),{x:350,y:0,width:900,height:900});
 assert.deepEqual(mirrorViewport(600,1000,{width:1200,height:1000}),{x:0,y:250,width:600,height:500});
 assert.deepEqual(mirrorViewport(800,500,{width:1600,height:1000}),{x:0,y:0,width:800,height:500});
});
