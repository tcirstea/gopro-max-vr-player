import {createFlatView,flatSize,FLAT_GLSL} from '../src/flat-view.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createZoomDetents} from '../src/zoom.js';
import {createXRViewDrag} from '../src/xr-view-drag.js';
import {createXRControls} from '../src/xr-controls.js';
import {maxLayout,MAX_GLSL} from '../src/max-projection.js';
import * as quaternions from '../src/quaternion.js';
import {mirrorViewport,mirrorDrawingBufferSize,invert4} from '../src/renderer.js';
const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
function harness({maxTexture=8192,maxRenderbuffer=8192,maxViewport=[8192,8192],pixelRatio=1,hasXR=true}={}){
 let windowFrame,xrFrame,framebuffer=null,viewport=[0,0,1,1],lost=false,failMirror=false,advances=0,uploads=0,panelUpdates=0;
 const draws=[],clears=[],panelDraws=[],events=[],canvasEvents={},sessionEvents={},documentEvents={},uniforms={},bindings=[],queries=[],viewports={left:{x:0,y:0,width:400,height:400},right:{x:400,y:0,width:400,height:400}};
 const gl=new Proxy({
  getShaderParameter:()=>true,getProgramParameter:()=>true,isContextLost:()=>lost,
  getUniformLocation:(_p,n)=>n,
  uniform1f:(n,v)=>uniforms[n]=v,
  uniform2fv:(n,v)=>uniforms[n]=Array.from(v),uniform3fv:(n,v)=>uniforms[n]=Array.from(v),
  uniformMatrix3fv:(n,_t,v)=>uniforms[n]=Array.from(v),
  uniformMatrix4fv:(n,_t,v)=>uniforms[n]=Array.from(v),
  getParameter:n=>{queries.push(n);return n==='FRAMEBUFFER_BINDING'?framebuffer:n==='MAX_TEXTURE_SIZE'?maxTexture:n==='MAX_RENDERBUFFER_SIZE'?maxRenderbuffer:n==='MAX_VIEWPORT_DIMS'?maxViewport:null;},
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
 const context=vm.createContext({createFlatView,flatSize,FLAT_GLSL,createZoomDetents,createXRViewDrag,createXRControls,maxLayout,MAX_GLSL,...quaternions,Event,CustomEvent,Promise,performance,document,navigator:{xr:hasXR?{requestSession:async()=>session}:undefined},requestAnimationFrame:f=>windowFrame=f,devicePixelRatio:pixelRatio,XRWebGLLayer:class{framebuffer='XR';getViewport(view){return viewports[view.eye]||viewports.left;}},createXRPanel:()=>({show(){},toggle(){},reset(){},update(){panelUpdates++;},draw(view){panelDraws.push({view,framebuffer,viewport:[...viewport]});}})});
 vm.runInContext(readFileSync(new URL('../src/renderer.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,''),context);
 const renderer=context.createRenderer(canvas);renderer.onBeforeRender(()=>advances++);
 const initialUploads=uploads;
 return {renderer,canvas,canvasEvents,document,documentEvents,session,sessionEvents,input,views,frame,draws,clears,panelDraws,events,uniforms,bindings,viewports,queries,gl,
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

test('headset sizing allocates black-bar space so the fitted eye reaches actual XR pixels',()=>{
 const eye={width:2000,height:1800},limits={quality:'headset',maxWidth:16384,maxHeight:16384};
 for(const [width,height]of [[800,450],[3840,2160],[450,800],[900,900],[1234,777]]){
  const {w,h}=mirrorDrawingBufferSize(width,height,eye,limits),fitted=mirrorViewport(w,h,eye);
  assert.ok(fitted.width>=eye.width);assert.ok(fitted.height>=eye.height);
  assert.ok(fitted.width<=eye.width+2);assert.ok(fitted.height<=eye.height+2);
  assert.ok(Math.abs(w/h-width/height)<.002);
  assert.deepEqual(mirrorDrawingBufferSize(width,height,eye,{...limits,pixelRatio:3}),{w,h},'XR pixels must not be multiplied by desktop DPR');
 }
 assert.deepEqual(mirrorDrawingBufferSize(3840,2160,{width:1920,height:1920},limits),{w:3414,h:1920});
});
test('sizing clamps both GPU dimensions uniformly and handles small or invalid bounds safely',()=>{
 const eye={width:2000,height:2000};
 assert.deepEqual(mirrorDrawingBufferSize(1600,900,eye,{quality:'headset',maxWidth:2048,maxHeight:4096}),{w:2048,h:1152});
 assert.deepEqual(mirrorDrawingBufferSize(1600,900,eye,{quality:'headset',maxWidth:8192,maxHeight:1024}),{w:1821,h:1024});
 const tiny=mirrorDrawingBufferSize(1,100000,eye,{quality:'headset',maxWidth:2,maxHeight:3});assert.deepEqual(tiny,{w:1,h:3});
 for(const value of [0,-1,NaN,Infinity]){
  assert.deepEqual(mirrorDrawingBufferSize(value,900,eye),{w:1,h:1});
  const size=mirrorDrawingBufferSize(1600,900,eye,{quality:'headset',maxWidth:value,maxHeight:value});assert.ok(size.w<=1280&&size.h<=1280);
 }
 assert.deepEqual(mirrorDrawingBufferSize(1600,900,null,{quality:'headset'}),{w:1280,h:720});
});
test('performance retains the 1280 cap, display DPR cap and smaller embedded view behavior',()=>{
 const limits={maxWidth:16384,maxHeight:16384};
 assert.deepEqual(mirrorDrawingBufferSize(3840,2160,null,limits),{w:1280,h:720});
 assert.deepEqual(mirrorDrawingBufferSize(400,250,null,{...limits,pixelRatio:3}),{w:800,h:500});
 assert.deepEqual(mirrorDrawingBufferSize(400,250,null,{...limits,pixelRatio:NaN}),{w:400,h:250});
 assert.deepEqual(mirrorDrawingBufferSize(800,500,null,{maxWidth:600,maxHeight:600}),{w:600,h:375});
});
test('quality changes are inert outside XR and disabled mirroring, including browsers with no XR',async()=>{
 const h=harness({hasXR:false});h.renderer.setDesktopMirrorQuality('headset');h.renderer.setDesktopMirror(true);h.windowTick();
 assert.equal(h.draws.length,1);assert.equal(h.draws[0].uniforms.xr,0);assert.equal(h.canvas.width,800);assert.equal(h.canvas.height,500);
 assert.equal(h.queries.includes('MAX_VIEWPORT_DIMS'),false);assert.equal(h.events.at(-1).detail.quality,'headset');
 await assert.rejects(h.renderer.enterVR(),/WebXR is unavailable/);
 const off=harness();off.renderer.setDesktopMirrorQuality('headset');await off.renderer.enterVR();off.tick();
 assert.equal(off.draws.length,2);assert.equal(off.canvas.width,800);assert.equal(off.queries.includes('MAX_VIEWPORT_DIMS'),false);
 const eventCount=off.events.length;off.renderer.setDesktopMirrorQuality('invalid');assert.equal(off.events.length,eventCount);
});
test('Match headset uses the actual left viewport and adapts live to fullscreen, eye resolution and quality',async()=>{
 const h=harness({pixelRatio:2});h.viewports.left={x:0,y:0,width:2000,height:1800};h.viewports.right={x:2000,y:0,width:2400,height:2100};
 h.renderer.setSource({tagName:'VIDEO',paused:false,readyState:3});h.renderer.setDesktopMirrorQuality('headset');h.renderer.setDesktopMirror(true);await h.renderer.enterVR();
 h.canvas.clientWidth=3840;h.canvas.clientHeight=2160;h.tick();
 assert.equal(h.canvas.width,3200);assert.equal(h.canvas.height,1800);assert.deepEqual(h.draws.at(-1).viewport,[600,0,2000,1800]);
 assert.deepEqual(h.draws[1].viewport,[0,0,2000,1800]);assert.deepEqual(h.draws[0].viewport,[2000,0,2400,2100]);
 assert.deepEqual(h.draws[1].uniforms,h.draws[2].uniforms);assert.equal(h.uploads,1);assert.equal(h.advances,1);
 h.canvas.clientWidth=600;h.canvas.clientHeight=1000;h.tick(20);assert.equal(h.canvas.width,2000);assert.equal(h.canvas.height,3334);assert.deepEqual(h.draws.at(-1).viewport,[0,767,2000,1800]);
 h.viewports.left={x:0,y:0,width:1000,height:1000};h.tick(40);assert.deepEqual(h.draws.at(-1).viewport,[0,333,1000,1000]);
 h.renderer.setDesktopMirrorQuality('performance');h.tick(60);assert.equal(h.canvas.width,768);assert.equal(h.canvas.height,1280);assert.deepEqual(h.draws.at(-1).viewport,[0,256,768,768]);
 h.renderer.setDesktopMirrorQuality('headset');h.tick(80);assert.equal(h.canvas.width,1000);assert.equal(h.canvas.height,1667);
 assert.equal(h.queries.filter(n=>n==='MAX_VIEWPORT_DIMS').length,1,'GPU caps are cached');assert.equal(h.advances,5);assert.equal(h.uploads,5);
 assert.equal(h.framebuffer,'XR');assert.deepEqual(h.viewport,[0,0,1000,1000]);
});
test('renderer honors texture, renderbuffer, viewport and actual allocation limits without altering XR',async()=>{
 for(const limits of [{maxTexture:2048},{maxRenderbuffer:2048},{maxViewport:[2048,4096]}]){
  const h=harness(limits);h.viewports.left={x:0,y:0,width:2000,height:2000};h.renderer.setDesktopMirrorQuality('headset');h.renderer.setDesktopMirror(true);await h.renderer.enterVR();h.tick();
  assert.equal(h.canvas.width,2048);assert.equal(h.canvas.height,1280);assert.deepEqual(h.draws.at(-1).viewport,[384,0,1280,1280]);
  assert.deepEqual(h.draws[1].viewport,[0,0,2000,2000]);assert.equal(h.framebuffer,'XR');
 }
 const h=harness();h.gl.drawingBufferWidth=1024;h.gl.drawingBufferHeight=640;h.renderer.setDesktopMirrorQuality('headset');h.renderer.setDesktopMirror(true);await h.renderer.enterVR();h.tick();
 assert.deepEqual(h.draws.at(-1).viewport,[192,0,640,640]);assert.equal(h.framebuffer,'XR');
 h.gl.drawingBufferWidth=0;h.tick(20);assert.equal(h.events.at(-1).type,'xrmirrorerror');assert.equal(h.events.at(-2).detail.quality,'headset');assert.equal(h.framebuffer,'XR');
 h.tick(40);assert.equal(h.advances,3);assert.equal(h.draws.length,7,'headset continues after unavailable mirror buffer');
});
test('headset quality persists only within the renderer session and does not reset view or playback',async()=>{
 const h=harness();h.renderer.setDesktopMirrorQuality('headset');h.renderer.setDesktopMirror(true);await h.renderer.enterVR();h.tick();
 h.renderer.setDesktopMirror(false);h.tick(20);h.renderer.setDesktopMirror(true);h.tick(40);assert.equal(h.events.at(-1).detail.quality,'headset');
 await h.renderer.enterVR();h.windowTick();assert.equal(h.canvas.width,800);assert.equal(h.canvas.height,500);
 await h.renderer.enterVR();h.tick(60);assert.equal(h.canvas.width,640);assert.equal(h.canvas.height,400);assert.equal(h.events.at(-1).detail.quality,'headset');
 const fresh=harness();fresh.renderer.setDesktopMirror(true);assert.equal(fresh.events.at(-1).detail.quality,'performance');
});

test('flat video uses a single world screen with separate tracked eye origins and identical mirror placement',async()=>{
 const h=harness();h.renderer.setSource({videoWidth:1920,videoHeight:1080},{projection:'flat'});h.renderer.setDesktopMirror(true);await h.renderer.enterVR();
 const head=identity.slice();head[13]=1.6;h.setPose({transform:{matrix:head},views:h.views});h.tick(0);
 const draws=h.draws.slice(-3);assert.equal(draws.length,3);for(const d of draws){assert.equal(d.uniforms.mode,2);assert.deepEqual(d.uniforms.flatCenter,[0,1.6,-2]);assert.equal(d.uniforms.flatSize[0],3.2);assert.ok(Math.abs(d.uniforms.flatSize[1]-1.8)<1e-9);}
 assert.notDeepEqual(draws[0].uniforms.viewRotation,draws[1].uniforms.viewRotation);assert.deepEqual(draws[1].uniforms.viewRotation,draws[2].uniforms.viewRotation);
 assert.deepEqual(draws[1].uniforms.invProjection,draws[2].uniforms.invProjection);
 const moved=head.slice();moved[12]=1;moved[14]=.5;h.setPose({transform:{matrix:moved},views:h.views});h.tick(20);assert.deepEqual(h.uniforms.flatCenter,[0,1.6,-2]);
});
test('flat stick zoom changes distance not FOV; grip cannot rotate it, and click recenters with default distance',async()=>{
 const h=harness();h.canvasEvents.wheel({deltaY:-100,preventDefault(){}});h.windowTick();const panoramaFov=h.uniforms.fov;
 h.renderer.setSource({videoWidth:720,videoHeight:1280},{projection:'flat'});await h.renderer.enterVR();h.tick(0);h.input.gamepad.axes[3]=-1;h.tick(50);
 assert.ok(h.uniforms.flatDistance<2);assert.equal(h.uniforms.fov,panoramaFov);assert.ok(Math.abs(h.uniforms.flatSize[0]/h.uniforms.flatSize[1]-9/16)<1e-9);
 const center=h.uniforms.flatCenter.slice(),rotation=h.uniforms.flatRotation.slice();h.input.gamepad.axes[3]=0;h.input.gamepad.buttons[1].pressed=true;h.tick(60);
 const turned=[0,0,-1,0,0,1,0,0,1,0,0,0,4,2,3,1];h.setController(turned);h.setPose({transform:{matrix:turned},views:h.views});h.tick(70);
 assert.deepEqual(h.uniforms.flatCenter,center);assert.deepEqual(h.uniforms.flatRotation,rotation);
 h.input.gamepad.buttons[3].pressed=true;h.tick(80);assert.equal(h.uniforms.flatDistance,2);assert.deepEqual(h.uniforms.flatCenter,[2,2,3]);assert.equal(h.uniforms.fov,panoramaFov);
 // Holding click is not a repeated reset; normal tracked movement continues.
 h.setPose({transform:{matrix:identity},views:h.views});h.tick(90);assert.deepEqual(h.uniforms.flatCenter,[2,2,3]);
 h.renderer.setSource(null);h.tick(100);assert.equal(h.uniforms.mode,0);assert.equal(h.uniforms.fov,panoramaFov);
});
test('flat reset defers through tracking loss and reanchors when the next valid center pose arrives',async()=>{
 const h=harness();h.renderer.setSource({videoWidth:100,videoHeight:100},{projection:'flat'});await h.renderer.enterVR();h.tick(0);
 h.setPose(null);h.renderer.reset();h.tick(20);
 const matrix=identity.slice();matrix[12]=4;matrix[13]=2;h.setPose({transform:{matrix},views:h.views});h.tick(40);assert.deepEqual(h.uniforms.flatCenter,[4,2,-2]);
 await h.renderer.enterVR();await h.renderer.enterVR();matrix[12]=6;h.tick(50);assert.deepEqual(h.uniforms.flatCenter,[6,2,-2]);
});
test('desktop flat disables pan, roll and keyboard tilt while preserving panorama view preferences',()=>{
 const h=harness();h.canvasEvents.pointerdown({pointerId:1,button:0,clientX:0,clientY:0});h.canvasEvents.pointermove({pointerId:1,clientX:20,clientY:30});h.canvasEvents.pointerup({pointerId:1});h.windowTick();
 const yaw=h.uniforms.yaw,pitch=h.uniforms.pitch;h.renderer.setSource({videoWidth:1920,videoHeight:1080},{projection:'flat'});
 for(const button of [0,2]){h.canvasEvents.pointerdown({pointerId:1,button,clientX:0,clientY:0});h.canvasEvents.pointermove({pointerId:1,clientX:80,clientY:80,buttons:button===2?2:1});h.canvasEvents.pointerup({pointerId:1});}
 h.canvasEvents.keydown({key:'ArrowUp',preventDefault(){}});h.canvasEvents.wheel({deltaY:-100,preventDefault(){}});h.windowTick();
 assert.equal(h.uniforms.yaw,yaw);assert.equal(h.uniforms.pitch,pitch);assert.equal(h.uniforms.roll,0);assert.ok(h.uniforms.flatDistance<2);
 h.canvasEvents.pointerdown({button:1,preventDefault(){}});h.windowTick();assert.equal(h.uniforms.flatDistance,2);
 h.renderer.setSource(null);h.canvasEvents.keydown({key:'ArrowUp',preventDefault(){}});h.windowTick();assert.equal(h.uniforms.pitch,pitch+.1);
});
