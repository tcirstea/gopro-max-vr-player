import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../src/app.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
function setup({inspect,create}={}){
 const elements=new Map(),players=[],revoked=[];
 function el(id){if(!elements.has(id))elements.set(id,{textContent:'',hidden:false,value:0,checked:true,paused:true,handlers:{},addEventListener(name,fn){(this.handlers[name]??=[]).push(fn);},emit(name){for(const fn of this.handlers[name]||[])fn({target:this});},canPlayType(){return '';},pause(){this.paused=true;},play(){this.paused=false;return Promise.resolve();},load(){this.readyState=0;},removeAttribute(){},replaceChildren(...children){this.children=children;}});return elements.get(id);}
 const context=vm.createContext({document:{getElementById:el,createElement:()=>({})},window:{addEventListener(){}},URL:{createObjectURL:()=>`blob:${Math.random()}`,revokeObjectURL:url=>revoked.push(url)},createRenderer:()=>({setSource(){},setMaxSources(){}}),demoPanorama:()=>({}),formatTime:String,inspectFile:inspect|| (async()=>({nativeCandidate:true,tracks:[]})),createNativePlayer:create|| (async(file,options)=>{const player={file,options,playing:false,duration:20,audioState:{available:true,modes:['stereo','ambisonic'],mode:'stereo'},setAudioMode(mode){this.audioState.mode=mode;},setMuted(value){this.muted=value;},setVolume(value){this.volume=value;},play(){this.playing=true;return Promise.resolve();},pause(){this.playing=false;},close(){this.closed=true;}};players.push(player);return player;})});
 vm.runInContext(source,context);
 return {context,el,players,revoked};
}
const files=[{name:'one.360',size:100},{name:'two.360',size:200},{name:'three.360',size:300}];
const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
test('multi selection, boundaries, paused/playing navigation and preferences',async()=>{
 const {context:c,el,players}=setup();
 await c.setPlaylist(files);
 assert.equal(el('previous').disabled,true);assert.equal(el('next').disabled,false);assert.equal(el('playlist-position').textContent,'1 / 3');assert.equal(players[0].playing,false);
 el('muted').checked=false;el('muted').emit('change');el('volume').value=.4;el('volume').emit('input');el('audio-mode').value='ambisonic';el('audio-mode').emit('change');
 await c.selectClip(1);assert.equal(players[1].playing,false);assert.equal(players[0].closed,true);assert.equal(players[1].muted,false);assert.equal(players[1].volume,.4);assert.equal(players[1].audioState.mode,'ambisonic');
 await c.togglePlayback();await c.selectClip(2);assert.equal(players[2].playing,true);assert.equal(el('next').disabled,true);assert.equal(el('previous').disabled,false);
 await c.selectClip(3);assert.equal(players.length,3);
 el('demo').emit('click');assert.equal(el('playlist').hidden,true);assert.equal(el('next').disabled,true);assert.equal(players[2].closed,true);
});
test('native end advances once, stops at last clip and ignores stale callbacks',async()=>{
 const {context:c,players,el}=setup();await c.setPlaylist(files.slice(0,2));
 const ended={playing:false,currentTime:20,duration:20};players[0].options.onState(ended);players[0].options.onState(ended);await flush();
 assert.equal(players.length,2);assert.equal(players[1].playing,true);assert.equal(el('playlist-position').textContent,'2 / 2');
 players[0].options.onState(ended);players[1].options.onState(ended);await flush();assert.equal(players.length,2);
});
test('newer selection wins metadata and stale player creation races',async()=>{
 let resolveFirst;const {context:c,el,players}=setup({inspect:file=>file.name==='one.360'?new Promise(resolve=>resolveFirst=resolve):Promise.resolve({nativeCandidate:true,tracks:[]})});
 const first=c.setPlaylist(files);await c.selectClip(1);resolveFirst({nativeCandidate:true,tracks:[]});await first;
 assert.equal(players.length,1);assert.equal(players[0].file.name,'two.360');assert.equal(el('filename').textContent,'two.360');
 let finish;const old={close(){this.closed=true;}};const other=setup({create:()=>new Promise(resolve=>finish=resolve)});const pending=other.context.setPlaylist(files);await flush();other.el('demo').emit('click');finish(old);await pending;assert.equal(old.closed,true);assert.equal(other.el('playlist').hidden,true);
});
test('failed clip remains skippable; cancel selection keeps queue',async()=>{
 const {context:c,el,players}=setup({inspect:async file=>{if(file.name==='one.360')throw Error('bad file');return {nativeCandidate:true,tracks:[]};}});
 await c.setPlaylist(files);assert.match(el('status').textContent,/bad file/);assert.equal(el('play').disabled,true);assert.equal(el('next').disabled,false);
 await c.setPlaylist([]);assert.equal(el('playlist-position').textContent,'1 / 3');await c.selectClip(1);assert.equal(players[0].playing,false);
});
test('browser clips require projection confirmation and auto-advance retains play intent',async()=>{
 const {context:c,el,revoked}=setup({inspect:async()=>({tracks:[],videoTracks:[{}]})});await c.setPlaylist(files.slice(0,2));
 assert.equal(el('equirect').hidden,false);el('equirect').emit('click');const video=el('video');video.readyState=2;video.videoWidth=200;video.videoHeight=100;video.emit('loadeddata');await c.togglePlayback();
 video.ended=true;video.emit('ended');await flush();assert.equal(el('playlist-position').textContent,'2 / 2');assert.equal(el('equirect').hidden,false);assert.equal(revoked.length,1);
 el('equirect').emit('click');video.readyState=2;video.emit('loadeddata');await flush();assert.equal(video.paused,false);
});
test('blocked auto-play remains usable and an old play rejection cannot overwrite a newer clip',async()=>{
 const {context:c,el,players}=setup();await c.setPlaylist(files);
 let rejectPlay;players[0].play=()=>new Promise((resolve,reject)=>rejectPlay=reject);
 const pending=c.togglePlayback();await c.selectClip(1,false);const status=el('status').textContent;rejectPlay(Error('old denial'));await pending;assert.equal(el('status').textContent,status);
 players[1].play=async()=>{throw Error('gesture required');};
 vm.runInContext('playWhenReady=true;resumeWhenReady(generation)',c);await flush();assert.match(el('status').textContent,/gesture required.*Press Play/);assert.equal(el('play').disabled,false);assert.equal(el('next').disabled,false);
});
test('queued end advance is canceled by demo or a newer queue',async()=>{
 const {context:c,el,players}=setup();await c.setPlaylist(files);
 players[0].options.onState({playing:false,currentTime:20,duration:20});el('demo').emit('click');await flush();assert.equal(players.length,1);assert.equal(el('playlist').hidden,true);
 await c.setPlaylist(files);players[1].options.onState({playing:false,currentTime:20,duration:20});await c.setPlaylist([files[2]]);await flush();assert.equal(el('playlist-position').textContent,'1 / 1');assert.equal(el('filename').textContent,'three.360');assert.equal(players.at(-1).playing,false);
});
