import {installDesktopFullscreenControls} from '../src/desktop-fullscreen-controls.js';
import {resolvePlaylistSeek,readPlaylistSeekDuration} from '../src/playlist-seek.js';
import {createNextClipPreloader,shouldPreloadNext} from '../src/next-clip-preload.js';
import {installKeyboardControls} from '../src/keyboard-controls.js';
import {createPlaylistEntries,sortPlaylistEntries,PLAYLIST_SORTS} from '../src/playlist-model.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function harness({graphicsAvailable=true}={}){
 const elements=new Map(),players=[],pending=new Map();let resets=0,panelProvider;const mirrorChoices=[],mirrorQualityChoices=[];
 const element=id=>{if(!elements.has(id))elements.set(id,{textContent:'',hidden:false,disabled:false,value:0,checked:true,handlers:{},addEventListener(n,f){this.handlers[n]=f;},canPlayType:()=>'',pause(){},load(){},removeAttribute(){},replaceChildren(){}});return elements.get(id);};
 const context=vm.createContext({installDesktopFullscreenControls,resolvePlaylistSeek,readPlaylistSeekDuration,createNextClipPreloader,shouldPreloadNext,prepareNextClip:async()=>null,installKeyboardControls,createPlaylistEntries,sortPlaylistEntries,PLAYLIST_SORTS,AbortController,createPlaylistBrowser:()=>({render(){},close(){}}),readPlaylistMetadata:async()=>({}),createPlaylistThumbnail:async()=>null,document:{getElementById:element},window:{addEventListener(){}},URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},createRenderer:()=>{if(!graphicsAvailable)throw Error('WebGL unavailable');return {setDesktopMirror(value){mirrorChoices.push(value);},setDesktopMirrorQuality(value){mirrorQualityChoices.push(value);},setSource(){},setMaxSources(){},onXRPanelState(fn){panelProvider=fn;},reset(){resets++;}};},demoPanorama:()=>({}),formatTime:String,inspectFile:async f=>({nativeCandidate:!f.flat,tracks:[],videoTracks:[{}]}),createNativePlayer:async(f,callbacks)=>{
 const player={name:f.name,callbacks,closed:false,duration:10,audioState:{available:!f.silent,modes:f.silent?[]:f.stereo?['stereo']:['stereo','ambisonic'],mode:'stereo'},setMuted(v){this.muted=v;},setVolume(v){this.volume=v;},setAudioMode(v){this.audioState.mode=v;},close(){this.closed=true;}};players.push(player);
 if(f.pending)await new Promise(resolve=>pending.set(f.name,resolve));return player;
 }});
 vm.runInContext(readFileSync(new URL('../src/app.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,''),context);
 const change=(id,value,event='change')=>{element(id)[id==='muted'?'checked':'value']=value;element(id).handlers[event]();};
 const open=async(name,extra={})=>{await context.openFile({name,size:100,...extra});assert.doesNotMatch(element('status').textContent,/Cannot open/);};
 return {element,context,players,pending,open,change,mirrorChoices,mirrorQualityChoices,get panelState(){return panelProvider();},mute:()=>element('canvas').handlers.xrpanelaction({detail:{action:'mute'}}),get resets(){return resets;}};
}
test('audio preferences survive native, flat and demo switches and explicit view reset is separate',async()=>{
 const h=harness();await h.open('one');h.change('muted',false);h.change('volume',.35,'input');h.change('audio-mode','ambisonic');
 await h.open('two');assert.equal(h.players[0].closed,true);assert.equal(h.players[1].muted,false);assert.equal(h.players[1].volume,.35);assert.equal(h.players[1].audioState.mode,'ambisonic');
 await h.open('flat',{flat:true});h.element('video').handlers.loadeddata();assert.equal(h.element('video').muted,false);assert.equal(h.element('video').volume,.35);
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
 await h.open('flat',{flat:true});h.element('video').handlers.loadeddata();h.mute();assert.equal(h.element('video').muted,true);assert.equal(h.element('muted').checked,true);
 await h.open('silent',{silent:true});assert.equal(h.panelState.canMute,false);h.mute();assert.equal(h.panelState.muted,true);
 const pending=h.open('pending',{pending:true});await new Promise(resolve=>setImmediate(resolve));h.mute();h.pending.get('pending')();await pending;
 assert.equal(h.players.at(-1).muted,false);assert.equal(h.panelState.muted,false);assert.equal(h.players.at(-1).audioState.mode,'ambisonic');assert.equal(h.players.at(-1).volume,.35);
 h.element('demo').handlers.click();assert.equal(h.panelState.muted,false);
});
test('browser audio preference is selectable before loading or while unsupported, without unmuting', async()=>{
 const h=harness();h.change('audio-mode','ambisonic');
 assert.equal(h.element('audio-mode').hidden,false);assert.equal(h.element('muted').checked,true);
 await h.open('stereo',{stereo:true});assert.equal(h.players.at(-1).audioState.mode,'stereo');assert.equal(h.element('audio-mode').value,'ambisonic');assert.match(h.element('audio-mode-note').textContent,/unavailable/);
 h.change('audio-mode','stereo');assert.equal(h.element('audio-mode').value,'stereo');
 await h.open('silent',{silent:true});h.change('audio-mode','ambisonic');assert.match(h.element('audio-mode-note').textContent,/unavailable/);
 await h.open('spatial');assert.equal(h.players.at(-1).audioState.mode,'ambisonic');assert.equal(h.players.at(-1).muted,true);
 h.change('audio-mode','invalid');assert.equal(h.players.at(-1).audioState.mode,'ambisonic');
});
test('identical frame audio state does not repeatedly mutate the live status region', async()=>{
 const h=harness();await h.open('one');const note=h.element('audio-mode-note');let value=note.textContent,writes=0;
 Object.defineProperty(note,'textContent',{get:()=>value,set:v=>{value=v;writes++;}});
 const player=h.players[0],state={audio:player.audioState,currentTime:1,duration:10,playing:true};
 player.callbacks.onState(state);player.callbacks.onState({...state,currentTime:2});assert.equal(writes,0);
 h.change('audio-mode','ambisonic');assert.equal(writes,1);player.callbacks.onState({...state,currentTime:3});assert.equal(writes,1);
});


test('desktop mirror is explicit session-only opt-in and follows renderer state/errors without changing playback preferences',async()=>{
 const h=harness(),classes=[];h.element('viewer').classList={toggle:(name,value)=>classes.push([name,value])};
 assert.equal(h.element('desktop-mirror').checked,false);assert.equal(h.element('desktop-mirror').disabled,false);assert.deepEqual(h.mirrorChoices,[]);
 h.element('desktop-mirror').checked=true;h.element('desktop-mirror').handlers.change();assert.deepEqual(h.mirrorChoices,[true]);
 h.element('canvas').handlers.xrmirrorchange({detail:{enabled:true,active:true}});assert.deepEqual(classes.at(-1),['xr-mirror-active',true]);
 await h.open('one');await h.open('two');assert.equal(h.element('desktop-mirror').checked,true);assert.deepEqual(h.mirrorChoices,[true]);
 h.element('canvas').handlers.xrmirrorchange({detail:{enabled:false,active:false}});h.element('canvas').handlers.xrmirrorerror({detail:'Desktop mirror stopped.'});
 assert.equal(h.element('desktop-mirror').checked,false);assert.deepEqual(classes.at(-1),['xr-mirror-active',false]);assert.equal(h.element('status').textContent,'Desktop mirror stopped.');
 assert.equal(h.element('muted').checked,true);assert.equal(h.players.at(-1).closed,false);
 assert.equal(harness().element('desktop-mirror').checked,false,'reload never restores an enabled mirror');
 const unavailable=harness({graphicsAvailable:false});assert.equal(unavailable.element('desktop-mirror').disabled,true);assert.equal(unavailable.element('desktop-mirror').checked,false);
});
test('mirror UI explains monitor visibility, costs and standalone limits and retains browser VR exit/fullscreen',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8'),css=readFileSync(new URL('../src/style.css',import.meta.url),'utf8');
 const input=html.match(/<input id="desktop-mirror"[^>]*>/)[0];assert.doesNotMatch(input,/checked/);assert.match(input,/aria-describedby="desktop-mirror-note"/);assert.match(input,/autocomplete="off"/);
 assert.match(html,/Anyone viewing this screen can see the video, the current filename and file date when VR controls are visible, and any open VR playlist/);assert.match(html,/GPU load/);assert.match(html,/No casting or uploads/);assert.match(html,/Standalone Quest does not send this view to a separate computer/);
 assert.match(css,/\.xr-mirror-active \.viewer-bottom>div/);assert.doesNotMatch(css,/\.xr-mirror-active \.viewer-bottom[,\{]/);
});

test('mirror quality is session-only, independently selectable and retained across clips, opt-out and errors',async()=>{
 const h=harness();assert.equal(h.element('desktop-mirror-quality').value,'performance');assert.equal(h.element('desktop-mirror-quality').disabled,false);assert.deepEqual(h.mirrorQualityChoices,[]);
 h.change('desktop-mirror-quality','headset');assert.deepEqual(h.mirrorQualityChoices,['headset']);assert.equal(h.element('desktop-mirror').checked,false);
 await h.open('one');await h.open('two');assert.equal(h.element('desktop-mirror-quality').value,'headset');assert.equal(h.resets,0);
 h.element('canvas').handlers.xrmirrorchange({detail:{enabled:false,active:false,quality:'headset'}});assert.equal(h.element('desktop-mirror-quality').value,'headset');
 h.element('canvas').handlers.xrmirrorerror({detail:'Desktop mirror stopped.'});assert.equal(h.element('desktop-mirror-quality').value,'headset');assert.equal(h.players.at(-1).closed,false);
 h.element('canvas').handlers.xrmirrorchange({detail:{enabled:false,active:false,quality:'performance'}});assert.equal(h.element('desktop-mirror-quality').value,'performance');
 assert.equal(harness().element('desktop-mirror-quality').value,'performance');assert.equal(harness({graphicsAvailable:false}).element('desktop-mirror-quality').disabled,true);
});
test('mirror quality UI labels choices and explains pixel targets, GPU cost, fullscreen and no-XR behavior',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/<label for="desktop-mirror-quality">Headset mirror quality<\/label>/);
 assert.match(html,/<select id="desktop-mirror-quality" aria-describedby="desktop-mirror-quality-note" autocomplete="off"><option value="performance">Performance<\/option><option value="headset">Match headset<\/option>/);
 assert.match(html,/Performance caps the mirror canvas at 1280 pixels/);assert.match(html,/actual resolution of one headset eye, including room for black bars, subject to GPU limits/);
 assert.match(html,/Useful for fullscreen; adds GPU load/);assert.match(html,/without a headset session, desktop viewing is unchanged/);assert.match(html,/Resets to Performance on reload/);
});

test('flat load without WebGL fails and completes pending readiness instead of hanging',async()=>{
 const h=harness({graphicsAvailable:false});let ready;
 await h.context.openFile({name:'flat.webm',size:100,flat:true},{onReady:value=>ready=value});
 assert.equal(ready,false);assert.match(h.element('status').textContent,/WebGL is required for video playback/);assert.equal(h.element('play').disabled,true);
});
test('flat visible help and mode label restore on demo and native frame transitions',async()=>{
 const h=harness();await h.open('flat.mp4',{flat:true});assert.equal(h.element('view-mode').textContent,'2D');assert.match(h.element('view-help').textContent,/Flat video/);
 h.element('demo').handlers.click();assert.equal(h.element('view-mode').textContent,'360°');assert.match(h.element('view-help').textContent,/Left-drag to pan/);
 await h.open('flat.mp4',{flat:true});await h.open('native.360');h.players.at(-1).callbacks.onFrames({},{});assert.equal(h.element('view-mode').textContent,'360°');assert.match(h.element('view-help').textContent,/Right-drag/);
});
