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
 assert.equal(zoomFov(DEFAULT_FOV,-100000),.4);
 assert.equal(zoomFov(DEFAULT_FOV,100000),2.1);
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
test('hidden session, disconnection, left hands and nonstandard/missing gamepads do nothing',()=>{
 const h=harness();h.tick(0);h.input.gamepad.axes=[0,0,1,0];
 h.session.visibilityState='visible-blurred';h.tick(10);assert.deepEqual(h.seek,[]);
 h.session.visibilityState='visible';h.input.gamepad.connected=false;h.tick(20);assert.deepEqual(h.seek,[]);
 h.input.gamepad.connected=true;h.input.handedness='left';h.tick(30);assert.deepEqual(h.seek,[]);
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
test('stick click recenters once, suppresses axes while held, and rearms on release',()=>{
 let recenters=0;const h=harness();
 const controls=createXRControls({zoom:v=>h.zoom.push(v),seek:v=>h.seek.push(v),togglePlayback:()=>h.toggles.push(true),recenter:()=>recenters++});
 controls.update(h.session,0);h.input.gamepad.axes=[0,0,1,1];h.input.gamepad.buttons[3].pressed=true;
 controls.update(h.session,20);controls.update(h.session,1000);assert.equal(recenters,1);assert.deepEqual(h.zoom,[]);assert.deepEqual(h.seek,[]);
 h.input.gamepad.buttons[4].pressed=true;controls.update(h.session,1020);assert.equal(h.toggles.length,1,'A remains independent');
 h.input.gamepad.buttons[3].pressed=false;controls.update(h.session,1040);assert.ok(h.zoom.at(-1)>0);
 h.input.gamepad.buttons[3].pressed=true;controls.update(h.session,1060);assert.equal(recenters,2);
 controls.reset();controls.update(h.session,1080);assert.equal(recenters,2,'held on session entry must not recenter');
 h.session.inputSources=[];controls.update(h.session,1100);h.session.inputSources=[h.input];controls.update(h.session,1120);assert.equal(recenters,2,'held on reconnect must not recenter');
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
