import {test} from 'node:test';
import assert from 'node:assert/strict';
import {placePanel,panelHit,panelTarget,createPanelTimer,createXRPanel} from '../src/xr-panel.js';
const identity=()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
test('panel is placed along controller ray and stays world anchored',()=>{
 const ray=identity(),viewer=identity();ray[12]=.3;const panel=placePanel(ray,viewer);
 assert.deepEqual(panel.center,[.3,0,-1.6]);const hit=panelHit(panel,ray);assert.ok(Math.abs(hit.u-.5)<1e-8);assert.ok(Math.abs(hit.v-.5)<1e-8);
 ray[12]=10;assert.equal(panelHit(panel,ray),null);assert.deepEqual(panel.center,[.3,0,-1.6]);
 const behind=identity();behind[10]=-1;assert.equal(panelHit(panel,behind),null);
 const overhead=identity();overhead[9]=-1;overhead[10]=0;assert.ok(placePanel(overhead,viewer).right.every(Number.isFinite));
});
test('buttons and broad progress target respect capabilities',()=>{
 const state={canMute:true,canPrevious:true,canPlay:true,canNext:true,canSeek:true};
 for(const [u,action] of [[.12,'previous'],[.312,'play'],[.504,'next'],[.696,'mute'],[.888,'exit']])assert.equal(panelTarget({u,v:.25},state),action);
 assert.equal(panelTarget({u:.1,v:.6},state),'seek');assert.equal(panelTarget({u:.1,v:.6},{}),null);
 assert.equal(panelTarget({u:.312,v:.25},{}),null);assert.equal(panelTarget({u:.888,v:.25},{}),'exit');
});
test('auto-hide counts two seconds only while playing, holds during interaction and resets cleanly',()=>{
 const timer=createPanelTimer();for(let t=0;t<=5000;t+=100)assert.equal(timer.update(t,false),false);
 for(let t=5100;t<7000;t+=100)assert.equal(timer.update(t,true),false);assert.equal(timer.update(7000,true),true);
 timer.reset();for(let t=0;t<=5000;t+=100)assert.equal(timer.update(t,true,true),false);
 for(let t=5100;t<7000;t+=100)assert.equal(timer.update(t,true),false);assert.equal(timer.update(7000,true),true);
});
function harness(t){
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'document');t.after(()=>descriptor?Object.defineProperty(globalThis,'document',descriptor):delete globalThis.document);
 const ctx=new Proxy({},{get:(obj,key)=>key in obj?obj[key]:()=>{}});globalThis.document={createElement:()=>({getContext:()=>ctx})};
 const gl=new Proxy({getShaderParameter:()=>true,getProgramParameter:()=>true},{get:(obj,key)=>key in obj?obj[key]:/^[A-Z_0-9]+$/.test(key)?key:()=>({})});
 const actions=[],state={mediaId:1,canPlay:true,canSeek:true,canPrevious:true,canNext:true,canMute:true,muted:true,playing:false,duration:100,currentTime:20};
 const left={handedness:'left',targetRaySpace:{},gamepad:{mapping:'xr-standard',buttons:[{pressed:false}]}};
 const right={handedness:'right',targetRaySpace:{},gamepad:{mapping:'xr-standard',buttons:[{pressed:false}]}};
 const rays=new Map([[left.targetRaySpace,identity()],[right.targetRaySpace,identity()]]);
 const session={inputSources:[left,right],visibilityState:'visible'};const frame={getPose:space=>rays.get(space)?{transform:{matrix:rays.get(space)}}:null};
 const panel=createXRPanel(gl,{getState:()=>state,onAction:(...args)=>actions.push(args)});let time=0;
 const tick=()=>panel.update(session,time+=16,frame,{},identity());
 const aim=(source,u,v)=>{const ray=identity();ray[12]=(u-.5)*1.2;ray[13]=(.5-v)*.375;rays.set(source.targetRaySpace,ray);};
 const trigger=(source,down)=>{source.gamepad.buttons[0].pressed=down;tick();};
 panel.toggle(right);tick();return {panel,tick,aim,trigger,left,right,session,state,actions,rays,gl,ctx};
}
test('either hand can activate transport with trigger press/release; held button never repeats',t=>{
 const h=harness(t);h.aim(h.left,.312,.25);h.trigger(h.left,true);h.tick();assert.deepEqual(h.actions,[]);h.trigger(h.left,false);assert.deepEqual(h.actions,[['play',undefined]]);
 h.aim(h.right,.888,.25);h.trigger(h.right,true);h.trigger(h.right,false);assert.equal(h.actions.at(-1)[0],'exit');
});
test('scrub previews throughout drag and commits once on release',t=>{
 const h=harness(t);h.aim(h.right,.28,.65);h.trigger(h.right,true);h.aim(h.right,.72,.65);h.tick();assert.deepEqual(h.actions,[]);h.trigger(h.right,false);assert.equal(h.actions.length,1);assert.equal(h.actions[0][0],'seek');assert.ok(Math.abs(h.actions[0][1]-.75)<1e-6);
});
test('toggle, focus loss, tracking loss, disconnect and clip change cancel captured seeks',t=>{
 const h=harness(t);
 for(const interruption of ['toggle','focus','tracking','disconnect','media']){
  h.panel.reset();h.session.inputSources=[h.left,h.right];h.session.visibilityState='visible';h.right.gamepad.buttons[0].pressed=false;h.rays.set(h.right.targetRaySpace,identity());h.panel.toggle(h.right);h.tick();h.aim(h.right,.5,.65);h.trigger(h.right,true);
  if(interruption==='toggle')h.panel.toggle(h.left);
  if(interruption==='focus')h.session.visibilityState='hidden';
  if(interruption==='tracking')h.rays.delete(h.right.targetRaySpace);
  if(interruption==='disconnect')h.session.inputSources=[h.left];
  if(interruption==='media')h.state.mediaId++;
  h.tick();h.trigger(h.right,false);assert.deepEqual(h.actions,[],interruption);
 }
});
test('holding trigger on initial appearance requires release before selection',t=>{
 const h=harness(t);h.panel.reset();h.right.gamepad.buttons[0].pressed=true;h.panel.toggle(h.right);h.tick();h.aim(h.right,.312,.25);h.trigger(h.right,false);assert.deepEqual(h.actions,[]);
 h.trigger(h.right,true);h.trigger(h.right,false);assert.equal(h.actions.length,1);
});

test('panel draw restores panorama GPU bindings even if texture painting fails',t=>{
 const h=harness(t),g=h.gl;
 const parameters={CURRENT_PROGRAM:'panorama',ARRAY_BUFFER_BINDING:'quad',ACTIVE_TEXTURE:'TEXTURE1',UNPACK_FLIP_Y_WEBGL:true,TEXTURE_BINDING_2D:'video'};
 g.getParameter=name=>parameters[name];g.getVertexAttrib=(index,name)=>({VERTEX_ATTRIB_ARRAY_ENABLED:true,VERTEX_ATTRIB_ARRAY_BUFFER_BINDING:'quad',VERTEX_ATTRIB_ARRAY_SIZE:2,VERTEX_ATTRIB_ARRAY_TYPE:'FLOAT',VERTEX_ATTRIB_ARRAY_NORMALIZED:false,VERTEX_ATTRIB_ARRAY_STRIDE:0}[name]);g.getVertexAttribOffset=()=>0;g.isEnabled=()=>true;
 g.activeTexture=value=>parameters.ACTIVE_TEXTURE=value;g.bindTexture=(target,value)=>parameters.TEXTURE_BINDING_2D=value;g.bindBuffer=(target,value)=>parameters.ARRAY_BUFFER_BINDING=value;g.useProgram=value=>parameters.CURRENT_PROGRAM=value;g.pixelStorei=(name,value)=>parameters[name]=value;
 const original={...parameters};h.panel.draw({projectionMatrix:identity(),transform:{inverse:{matrix:identity()}}});assert.deepEqual(parameters,original);
 h.state.currentTime++;g.texImage2D=()=>{throw Error('GPU upload failed');};assert.throws(()=>h.panel.draw({projectionMatrix:identity(),transform:{inverse:{matrix:identity()}}}),/GPU upload failed/);assert.deepEqual(parameters,original);
});

test('mute is selected once per index-trigger click by either hand, but never when unavailable',t=>{
 const h=harness(t);
 for(const hand of [h.left,h.right]){
  h.aim(hand,.696,.25);h.trigger(hand,true);h.tick();assert.equal(h.actions.length,hand===h.left?0:1);h.trigger(hand,false);
 }
 assert.deepEqual(h.actions,[['mute',undefined],['mute',undefined]]);
 h.state.canMute=false;h.trigger(h.right,true);h.trigger(h.right,false);assert.equal(h.actions.length,2);
 assert.equal(panelTarget({u:.696,v:.25},{}),null);
});
test('mute label repaints immediately after browser state changes, without exposing audio styles',t=>{
 const h=harness(t),labels=[];h.ctx.fillText=text=>labels.push(text);
 const view={projectionMatrix:identity(),transform:{inverse:{matrix:identity()}}};h.panel.draw(view);
 assert.ok(labels.includes('Unmute'));assert.ok(!labels.some(x=>/stereo|ambisonic|spatial/i.test(x)));
 labels.length=0;h.state.muted=false;h.panel.draw(view);assert.ok(labels.includes('Mute'));assert.ok(!labels.includes('Unmute'));
 labels.length=0;h.state.canMute=false;h.panel.draw(view);assert.ok(labels.includes('Mute'));
});
