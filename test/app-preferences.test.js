import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function harness(){
 const elements=new Map(),players=[],pending=new Map();let resets=0,panelProvider;
 const element=id=>{if(!elements.has(id))elements.set(id,{textContent:'',hidden:false,disabled:false,value:0,checked:true,handlers:{},addEventListener(n,f){this.handlers[n]=f;},canPlayType:()=>'',pause(){},load(){},removeAttribute(){},replaceChildren(){}});return elements.get(id);};
 const context=vm.createContext({document:{getElementById:element},window:{addEventListener(){}},URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},createRenderer:()=>({setSource(){},setMaxSources(){},onXRPanelState(fn){panelProvider=fn;},reset(){resets++;}}),demoPanorama:()=>({}),formatTime:String,inspectFile:async f=>({nativeCandidate:!f.flat,tracks:[],videoTracks:[{}]}),createNativePlayer:async(f,callbacks)=>{
 const player={name:f.name,callbacks,closed:false,duration:10,audioState:{available:!f.silent,modes:f.silent?[]:f.stereo?['stereo']:['stereo','ambisonic'],mode:'stereo'},setMuted(v){this.muted=v;},setVolume(v){this.volume=v;},setAudioMode(v){this.audioState.mode=v;},close(){this.closed=true;}};players.push(player);
 if(f.pending)await new Promise(resolve=>pending.set(f.name,resolve));return player;
 }});
 vm.runInContext(readFileSync(new URL('../src/app.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,''),context);
 const change=(id,value,event='change')=>{element(id)[id==='muted'?'checked':'value']=value;element(id).handlers[event]();};
 const open=async(name,extra={})=>{await context.openFile({name,size:100,...extra});assert.doesNotMatch(element('status').textContent,/Cannot open/);};
 return {element,context,players,pending,open,change,get panelState(){return panelProvider();},mute:()=>element('canvas').handlers.xrpanelaction({detail:{action:'mute'}}),get resets(){return resets;}};
}
test('audio preferences survive native, flat and demo switches and explicit view reset is separate',async()=>{
 const h=harness();await h.open('one');h.change('muted',false);h.change('volume',.35,'input');h.change('audio-mode','ambisonic');
 await h.open('two');assert.equal(h.players[0].closed,true);assert.equal(h.players[1].muted,false);assert.equal(h.players[1].volume,.35);assert.equal(h.players[1].audioState.mode,'ambisonic');
 await h.open('flat',{flat:true});h.element('equirect').handlers.click();h.element('video').handlers.loadeddata();assert.equal(h.element('video').muted,false);assert.equal(h.element('video').volume,.35);
 h.change('volume',.6,'input');h.element('demo').handlers.click();assert.equal(h.resets,0);assert.equal(h.element('volume').value,.6);
 await h.open('three');assert.equal(h.players.at(-1).volume,.6);assert.equal(h.players.at(-1).audioState.mode,'ambisonic');assert.equal(h.players.at(-1).muted,false);
 h.element('reset').handlers.click();assert.equal(h.resets,1);
});
test('unsupported and silent clips preserve desired spatial mode for a later compatible clip',async()=>{
 const h=harness();await h.open('spatial');h.change('audio-mode','ambisonic');h.change('muted',false);h.change('volume',0,'input');
 await h.open('stereo',{stereo:true});assert.equal(h.players.at(-1).audioState.mode,'stereo');assert.match(h.element('status').textContent,/preference is kept/);
 await h.open('silent',{silent:true});assert.equal(h.element('muted').disabled,true);assert.equal(h.element('muted').checked,false);
 await h.open('spatial-again');assert.equal(h.players.at(-1).audioState.mode,'ambisonic');assert.equal(h.players.at(-1).volume,0);assert.equal(h.players.at(-1).muted,false);assert.equal(h.element('muted').disabled,false);
});
test('pending open applies latest preferences and stale player completion/callbacks cannot overwrite them',async()=>{
 const h=harness();await h.open('first');h.change('audio-mode','ambisonic');
 const old=h.open('old',{pending:true});await new Promise(resolve=>setImmediate(resolve));
 h.change('muted',false);h.change('volume',.2,'input');
 const current=h.open('current',{pending:true});await new Promise(resolve=>setImmediate(resolve));h.change('volume',.8,'input');
 h.pending.get('current')();await current;const player=h.players.at(-1);assert.equal(player.volume,.8);assert.equal(player.muted,false);assert.equal(player.audioState.mode,'ambisonic');
 h.pending.get('old')();await old;assert.equal(h.players[1].closed,true);
 const status=h.element('status').textContent;h.players[1].callbacks.onState({audio:{available:false,modes:[],mode:'stereo'}});h.players[1].callbacks.onError(Error('stale'));h.players[1].callbacks.onFrames({},{});
 assert.equal(h.element('status').textContent,status);assert.equal(h.element('audio-mode').value,'ambisonic');assert.equal(h.element('volume').value,.8);
});
test('volume slider clamps values and ignores nonfinite input',async()=>{
 const h=harness();await h.open('one');h.change('volume',2,'input');assert.equal(h.players[0].volume,1);h.change('volume',-2,'input');assert.equal(h.players[0].volume,0);h.change('volume','invalid','input');assert.equal(h.players[0].volume,0);
});

test('VR mute shares browser preference across native, flat, silent, and pending clip switches',async()=>{
 const h=harness();await h.open('one');h.change('audio-mode','ambisonic');h.change('volume',.35,'input');
 assert.equal(h.panelState.muted,true);assert.equal(h.panelState.canMute,true);
 h.mute();assert.equal(h.panelState.muted,false);assert.equal(h.element('muted').checked,false);assert.equal(h.players.at(-1).muted,false);assert.equal(h.element('video').muted,false);
 h.change('muted',true);assert.equal(h.panelState.muted,true);h.mute();
 await h.open('two');assert.equal(h.players.at(-1).muted,false);assert.equal(h.players.at(-1).volume,.35);assert.equal(h.players.at(-1).audioState.mode,'ambisonic');
 await h.open('flat',{flat:true});h.element('equirect').handlers.click();h.element('video').handlers.loadeddata();h.mute();assert.equal(h.element('video').muted,true);assert.equal(h.element('muted').checked,true);
 await h.open('silent',{silent:true});assert.equal(h.panelState.canMute,false);h.mute();assert.equal(h.panelState.muted,true);
 const pending=h.open('pending',{pending:true});await new Promise(resolve=>setImmediate(resolve));h.mute();h.pending.get('pending')();await pending;
 assert.equal(h.players.at(-1).muted,false);assert.equal(h.panelState.muted,false);assert.equal(h.players.at(-1).audioState.mode,'ambisonic');assert.equal(h.players.at(-1).volume,.35);
 h.element('demo').handlers.click();assert.equal(h.panelState.muted,false);
});
