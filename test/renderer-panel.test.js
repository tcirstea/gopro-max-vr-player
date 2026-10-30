import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createZoomDetents} from '../src/zoom.js';
import {createXRViewDrag} from '../src/xr-view-drag.js';
import {createXRControls} from '../src/xr-controls.js';
import {maxLayout,MAX_GLSL} from '../src/max-projection.js';
import * as quaternions from '../src/quaternion.js';

test('renderer lazily wires B/Y panel, frame/per-eye rendering, deferred actions, exit and lifecycle resets',async()=>{
 let xrFrame,options,created=0,resets=0,ends=0,requests=0,action=null,insideFrame=false;
 const events=[],toggles=[],updates=[],draws=[],sessionEvents={};
 const gl=new Proxy({getShaderParameter:()=>true,getProgramParameter:()=>true,isContextLost:()=>false,getUniformLocation:(_p,n)=>n},{get:(t,k)=>k in t?t[k]:/^[A-Z_0-9]+$/.test(k)?1:()=>({})});
 const canvas={getContext:()=>gl,addEventListener(){},dispatchEvent(event){assert.equal(insideFrame,false,'panel actions must not mutate app during rendering');events.push(event);}};
 const input=handedness=>({handedness,gamepad:{mapping:'xr-standard',axes:[0,0,0,0],buttons:Array.from({length:6},()=>({pressed:false}))}});
 const right=input('right'),left=input('left');
 const session={visibilityState:'visible',inputSources:[left,right],renderState:{},async requestReferenceSpace(){return {reference:true};},updateRenderState(s){Object.assign(this.renderState,s);},addEventListener(n,f){sessionEvents[n]=f;},requestAnimationFrame(f){xrFrame=f;},async end(){ends++;sessionEvents.end?.();}};
 const context=vm.createContext({createZoomDetents,createXRViewDrag,createXRControls,maxLayout,MAX_GLSL,...quaternions,Event,CustomEvent,Promise,performance,document:{getElementById:()=>null},navigator:{xr:{requestSession:async()=>{requests++;return session;}}},requestAnimationFrame(){},XRWebGLLayer:class{getViewport(){return {x:0,y:0,width:400,height:300};}},createXRPanel:(_gl,callbacks)=>{
  assert.equal(_gl,gl);created++;options=callbacks;return {toggle(s){toggles.push(s);},reset(){resets++;},update(...args){updates.push(args);if(action){callbacks.onAction(...action);action=null;}},draw(view){draws.push(view);}};
 }});
 vm.runInContext(readFileSync(new URL('../src/renderer.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,''),context);
 const renderer=context.createRenderer(canvas);assert.equal(created,0);const state={playing:true,volume:.4};const unsubscribe=renderer.onXRPanelState(()=>state);
 await renderer.enterVR();assert.equal(created,0);
 const matrix=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],views=[{eye:'left',projectionMatrix:matrix,transform:{matrix}},{eye:'right',projectionMatrix:matrix,transform:{matrix}}];
 let pose={transform:{matrix},views};const frame={session,getViewerPose:()=>pose};
 const tick=time=>{insideFrame=true;try{xrFrame(time,frame);}finally{insideFrame=false;}};
 tick(0);left.gamepad.buttons[5].pressed=true;tick(20);assert.equal(created,1);assert.deepEqual(toggles,[left]);assert.equal(options.getState(),state);assert.equal(updates.length,1);assert.equal(updates[0][0],session);assert.equal(updates[0][2],frame);assert.deepEqual(draws,views);
 tick(40);assert.equal(toggles.length,1);assert.equal(updates.length,2);assert.equal(draws.length,4);
 right.gamepad.buttons[5].pressed=true;tick(60);assert.equal(created,1);assert.deepEqual(toggles,[left,right]);
 action=['volume',.7];tick(80);assert.equal(events.length,0);await Promise.resolve();assert.equal(events.at(-1).type,'xrpanelaction');assert.equal(events.at(-1).detail.action,'volume');assert.equal(events.at(-1).detail.value,.7);
 unsubscribe();assert.equal(Object.keys(options.getState()).length,0);
 const beforeReset=resets;pose=null;tick(100);assert.equal(resets,beforeReset+1);pose={transform:{matrix},views};sessionEvents.visibilitychange();assert.equal(resets,beforeReset+2);
 action=['exit'];tick(120);assert.equal(ends,0);await new Promise(resolve=>setImmediate(resolve));assert.equal(ends,1);assert.equal(requests,1,'exit must not request a new immersive session');assert.equal(resets,beforeReset+3);assert.equal(events.at(-1).type,'vrend');
 await renderer.enterVR();assert.equal(requests,2);assert.equal(created,1);assert.equal(resets,beforeReset+4);
 // Actions queued for an ended session must not leak into the next page state.
 const count=events.length;options.onAction('play');await session.end();await new Promise(resolve=>setImmediate(resolve));assert.equal(events.length,count+1);assert.equal(events.at(-1).type,'vrend');
});
