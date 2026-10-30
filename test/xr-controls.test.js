import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createXRControls,zoomFov,DEFAULT_FOV} from '../src/xr-controls.js';

function harness(){
 const zoom=[],seek=[],toggles=[];
 const input={handedness:'right',gamepad:{mapping:'xr-standard',connected:true,axes:[0,0,0,0],buttons:Array.from({length:6},()=>({pressed:false}))}};
 const session={visibilityState:'visible',inputSources:[input]};
 const controls=createXRControls({zoom:v=>zoom.push(v),seek:v=>seek.push(v),togglePlayback:()=>toggles.push(true)});
 return {controls,input,session,zoom,seek,toggles,tick:t=>controls.update(session,t)};
}
test('shared wheel/FOV zoom preserves limits and forward-stick direction',()=>{
 assert.equal(zoomFov(DEFAULT_FOV,0),DEFAULT_FOV);
 assert.equal(zoomFov(DEFAULT_FOV,-100000),.15);
 assert.equal(zoomFov(DEFAULT_FOV,100000),2.8);
 const h=harness();h.tick(0);h.input.gamepad.axes[3]=-1;h.tick(20);
 assert.equal(h.zoom.at(-1),-12);assert.equal(zoomFov(DEFAULT_FOV,h.zoom.at(-1)),DEFAULT_FOV-.012);
 h.input.gamepad.axes[3]=1;h.tick(40);assert.equal(h.zoom.at(-1),12);
 assert.deepEqual(h.seek,[]);
});
test('zoom is frame-time based with dead zone, dominant axis and bounded resume delta',()=>{
 const h=harness();h.tick(0);h.input.gamepad.axes=[0,0,.19,.19];h.tick(20);assert.equal(h.zoom.length,0);
 h.input.gamepad.axes=[0,0,.6,-.9];h.tick(40);assert.ok(h.zoom[0]<0);assert.deepEqual(h.seek,[]);
 h.tick(10000);assert.ok(Math.abs(h.zoom.at(-1))<=30);
 h.input.gamepad.axes=[0,0,NaN,Infinity];h.tick(10020);assert.deepEqual(h.seek,[]);
});
test('horizontal seeks step immediately, repeat at 500ms, and reverse/rearm without zoom',()=>{
 const h=harness();h.tick(0);h.input.gamepad.axes[2]=1;h.tick(10);h.tick(20);h.tick(509);
 assert.deepEqual(h.seek,[5]);h.tick(510);assert.deepEqual(h.seek,[5,5]);
 h.input.gamepad.axes[2]=-1;h.tick(520);assert.deepEqual(h.seek,[5,5,-5]);
 h.input.gamepad.axes[2]=0;h.tick(530);h.input.gamepad.axes[2]=-1;h.tick(540);assert.deepEqual(h.seek,[5,5,-5,-5]);
 assert.deepEqual(h.zoom,[]);
});
test('A toggles once per press; held entry and unrelated buttons are ignored',()=>{
 const h=harness();h.input.gamepad.buttons[4].pressed=true;h.tick(0);h.tick(10);assert.equal(h.toggles.length,0);
 h.input.gamepad.buttons[4].pressed=false;h.tick(20);h.input.gamepad.buttons[0].pressed=true;h.tick(30);assert.equal(h.toggles.length,0);
 h.input.gamepad.buttons[4].pressed=true;h.tick(40);h.tick(50);assert.equal(h.toggles.length,1);
 h.input.gamepad.buttons[4].pressed=false;h.tick(60);h.input.gamepad.buttons[4].pressed=true;h.tick(70);assert.equal(h.toggles.length,2);
});
test('hidden session, disconnection, unhanded inputs and nonstandard/missing gamepads do nothing',()=>{
 const h=harness();h.tick(0);h.input.gamepad.axes=[0,0,1,0];
 h.session.visibilityState='visible-blurred';h.tick(10);assert.deepEqual(h.seek,[]);
 h.session.visibilityState='visible';h.input.gamepad.connected=false;h.tick(20);assert.deepEqual(h.seek,[]);
 h.input.gamepad.connected=true;h.input.handedness='none';h.tick(30);assert.deepEqual(h.seek,[]);
 h.input.handedness='right';h.input.hand={};h.tick(40);assert.deepEqual(h.seek,[]);
 delete h.input.hand;h.input.gamepad.mapping='';h.tick(50);assert.deepEqual(h.seek,[]);
 h.input.gamepad=null;h.tick(60);assert.deepEqual(h.seek,[]);
 h.session.inputSources=[];h.tick(70);h.controls.reset();h.tick(80);
});
test('reset and controller reconnect clear repeat and button state',()=>{
 const h=harness();h.tick(0);h.input.gamepad.axes[2]=1;h.tick(10);h.controls.reset();h.tick(20);assert.deepEqual(h.seek,[5,5]);
 h.session.inputSources=[];h.tick(30);h.input.gamepad.buttons[4].pressed=true;h.session.inputSources=[h.input];h.tick(40);assert.deepEqual(h.toggles,[]);
 h.input.gamepad.buttons[4].pressed=false;h.tick(50);h.input.gamepad.buttons[4].pressed=true;h.tick(60);assert.equal(h.toggles.length,1);
});
test('stick click resets zoom once, suppresses axes while held, and rearms on release',()=>{
 let zoomResets=0;const h=harness();
 const controls=createXRControls({zoom:v=>h.zoom.push(v),seek:v=>h.seek.push(v),togglePlayback:()=>h.toggles.push(true),resetZoom:()=>zoomResets++});
 controls.update(h.session,0);h.input.gamepad.axes=[0,0,1,1];h.input.gamepad.buttons[3].pressed=true;
 controls.update(h.session,20);controls.update(h.session,1000);assert.equal(zoomResets,1);assert.deepEqual(h.zoom,[]);assert.deepEqual(h.seek,[]);
 h.input.gamepad.buttons[4].pressed=true;controls.update(h.session,1020);assert.equal(h.toggles.length,1,'A remains independent');
 h.input.gamepad.buttons[3].pressed=false;controls.update(h.session,1040);assert.ok(h.zoom.at(-1)>0);
 h.input.gamepad.buttons[3].pressed=true;controls.update(h.session,1060);assert.equal(zoomResets,2);
 controls.reset();controls.update(h.session,1080);assert.equal(zoomResets,2,'held on session entry must not reset zoom');
 h.session.inputSources=[];controls.update(h.session,1100);h.session.inputSources=[h.input];controls.update(h.session,1120);assert.equal(zoomResets,2,'held on reconnect must not reset zoom');
});
test('grip rising/release edges clutch once, ignore held entry, and preserve zoom and A',()=>{
 const h=harness(),drag=[],sources=[];const controls=createXRControls({zoom:v=>h.zoom.push(v),seek:v=>h.seek.push(v),togglePlayback:()=>h.toggles.push(true),dragView:(v,source)=>{drag.push(v);if(v)sources.push(source);}});
 h.input.gamepad.buttons[1].pressed=true;controls.update(h.session,0);controls.update(h.session,20);assert.deepEqual(drag,[]);
 h.input.gamepad.buttons[1].pressed=false;controls.update(h.session,40);h.input.gamepad.buttons[1].pressed=true;controls.update(h.session,60);controls.update(h.session,80);assert.deepEqual(drag,[true]);assert.equal(sources[0],h.input);
 h.input.gamepad.axes[3]=-1;h.input.gamepad.buttons[4].pressed=true;controls.update(h.session,100);assert.equal(h.zoom.at(-1),-12);assert.equal(h.toggles.length,1);
 h.input.gamepad.buttons[1].pressed=false;controls.update(h.session,120);controls.update(h.session,140);assert.deepEqual(drag,[true,false]);
 h.input.gamepad.buttons[1].pressed=true;controls.update(h.session,160);h.session.visibilityState='hidden';controls.update(h.session,180);assert.deepEqual(drag,[true,false,true,false]);
 h.session.visibilityState='visible';controls.update(h.session,200);assert.equal(drag.length,4,'held on focus recovery ignored');
 h.input.gamepad.buttons[1].pressed=false;controls.update(h.session,220);h.input.gamepad.buttons[1].pressed=true;controls.update(h.session,240);h.session.inputSources=[];controls.update(h.session,260);assert.deepEqual(drag,[true,false,true,false,true,false]);
 h.session.inputSources=[h.input];controls.update(h.session,280);assert.equal(drag.length,6,'held on reconnect ignored');
});
function dualHarness(){
 const h=harness(),left=structuredClone(h.input);left.handedness='left';h.session.inputSources=[left,h.input];
 const calls={zoom:[],seek:[],play:0,panel:[],reset:0,drag:[],end:0};
 const controls=createXRControls({zoom:(delta,time)=>calls.zoom.push([delta,time]),seek:v=>calls.seek.push(v),togglePlayback:()=>calls.play++,togglePanel:source=>calls.panel.push(source),resetZoom:()=>calls.reset++,dragView:(active,source)=>calls.drag.push([active,source]),zoomEnd:()=>calls.end++});
 return {...h,left,calls,controls,tick:t=>controls.update(h.session,t)};
}
test('left controller mirrors stick zoom, seek, click, X playback, Y panel and grip source',()=>{
 const h=dualHarness();h.tick(0);h.left.gamepad.axes[3]=-1;h.tick(20);assert.deepEqual(h.calls.zoom,[[-12,20]]);
 h.left.gamepad.axes=[0,0,-1,0];h.tick(40);assert.deepEqual(h.calls.seek,[-5]);
 h.left.gamepad.buttons[3].pressed=true;h.left.gamepad.buttons[4].pressed=true;h.left.gamepad.buttons[5].pressed=true;h.left.gamepad.buttons[1].pressed=true;h.tick(60);
 assert.equal(h.calls.reset,1);assert.equal(h.calls.play,1);assert.deepEqual(h.calls.panel,[h.left]);assert.deepEqual(h.calls.drag,[[true,h.left]]);assert.deepEqual(h.calls.seek,[-5]);h.tick(80);assert.equal(h.calls.panel.length,1);
});
test('simultaneous sticks prefer right; simultaneous buttons coalesce and edges remain independent',()=>{
 const h=dualHarness();h.tick(0);h.left.gamepad.axes[3]=-1;h.input.gamepad.axes[3]=1;
 for(const s of [h.left,h.input])for(const i of [3,4,5])s.gamepad.buttons[i].pressed=true;
 h.tick(20);assert.equal(h.calls.reset,1);assert.equal(h.calls.play,1);assert.deepEqual(h.calls.panel,[h.input]);assert.deepEqual(h.calls.zoom,[]);
 for(const s of [h.left,h.input])s.gamepad.buttons[3].pressed=false;h.tick(40);assert.deepEqual(h.calls.zoom.at(-1),[12,40]);
 h.input.gamepad.axes[3]=0;h.tick(60);assert.deepEqual(h.calls.zoom.at(-1),[-12,60]);
 h.left.gamepad.buttons[4].pressed=false;h.left.gamepad.buttons[5].pressed=false;h.tick(80);h.left.gamepad.buttons[4].pressed=true;h.left.gamepad.buttons[5].pressed=true;h.tick(100);assert.equal(h.calls.play,2);assert.equal(h.calls.panel.at(-1),h.left);
});
test('first grip owner retains control; held competing grip cannot steal after release/disconnect',()=>{
 const h=dualHarness();h.tick(0);h.left.gamepad.buttons[1].pressed=true;h.tick(20);h.input.gamepad.buttons[1].pressed=true;h.tick(40);assert.deepEqual(h.calls.drag,[[true,h.left]]);
 h.left.gamepad.buttons[1].pressed=false;h.tick(60);assert.deepEqual(h.calls.drag,[[true,h.left],[false,h.left]]);h.tick(80);assert.equal(h.calls.drag.length,2);
 h.input.gamepad.buttons[1].pressed=false;h.tick(100);h.input.gamepad.buttons[1].pressed=true;h.tick(120);assert.deepEqual(h.calls.drag.at(-1),[true,h.input]);
 h.left.gamepad.buttons[1].pressed=true;h.tick(140);h.session.inputSources=[h.left];h.tick(160);assert.deepEqual(h.calls.drag.at(-1),[false,h.input]);assert.equal(h.calls.drag.length,4);
 h.left.gamepad.buttons[1].pressed=false;h.tick(180);h.left.gamepad.buttons[1].pressed=true;h.tick(200);assert.deepEqual(h.calls.drag.at(-1),[true,h.left]);
});
test('simultaneous grips prefer right; held buttons on reconnect/focus are guarded on both hands',()=>{
 const h=dualHarness();h.tick(0);for(const s of [h.left,h.input])s.gamepad.buttons[1].pressed=true;h.tick(20);assert.deepEqual(h.calls.drag,[[true,h.input]]);
 h.session.visibilityState='hidden';h.tick(40);for(const s of [h.left,h.input])for(const i of [3,4,5])s.gamepad.buttons[i].pressed=true;
 h.session.visibilityState='visible';h.tick(60);assert.equal(h.calls.drag.length,2);assert.equal(h.calls.play,0);assert.equal(h.calls.reset,0);assert.deepEqual(h.calls.panel,[]);
 h.session.inputSources=[];h.tick(80);h.session.inputSources=[h.left,h.input];h.tick(100);assert.equal(h.calls.drag.length,2);assert.equal(h.calls.play,0);assert.equal(h.calls.reset,0);assert.deepEqual(h.calls.panel,[]);
});
test('zoomEnd requires both axes neutral, not horizontal movement or click, and resets on source loss',()=>{
 const h=dualHarness();h.tick(0);h.left.gamepad.axes[3]=-1;h.tick(20);assert.equal(h.calls.end,0);
 h.left.gamepad.axes=[0,0,1,0];h.tick(40);assert.equal(h.calls.end,0);
 h.left.gamepad.buttons[3].pressed=true;h.tick(60);assert.equal(h.calls.end,0);
 h.left.gamepad.axes=[0,0,.2,-.2];h.tick(80);assert.equal(h.calls.end,1);h.tick(100);assert.equal(h.calls.end,1);
 h.left.gamepad.buttons[3].pressed=false;h.left.gamepad.axes[3]=-1;h.tick(120);h.session.inputSources=[h.input];h.tick(140);assert.equal(h.calls.end,2);
 h.input.gamepad.axes[3]=1;h.tick(160);h.controls.reset();assert.equal(h.calls.end,3);h.controls.reset();assert.equal(h.calls.end,3);
});
