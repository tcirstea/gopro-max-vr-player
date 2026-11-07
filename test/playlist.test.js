import {resolvePlaylistSeek,readPlaylistSeekDuration} from '../src/playlist-seek.js';
import {createNextClipPreloader,shouldPreloadNext} from '../src/next-clip-preload.js';
import {installKeyboardControls} from '../src/keyboard-controls.js';
import {createPlaylistEntries,sortPlaylistEntries,PLAYLIST_SORTS} from '../src/playlist-model.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../src/app.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
function setup({inspect,create,prepare,readDuration}={}){
 const elements=new Map(),players=[],revoked=[],createdObjects=[],sources=[],windowHandlers={};
 function el(id){if(!elements.has(id))elements.set(id,{textContent:'',hidden:false,value:0,checked:true,paused:true,handlers:{},addEventListener(name,fn){(this.handlers[name]??=[]).push(fn);},emit(name){for(const fn of this.handlers[name]||[])fn({target:this});},canPlayType(){return '';},pause(){this.paused=true;},play(){this.paused=false;return Promise.resolve();},load(){this.readyState=0;},removeAttribute(){},replaceChildren(...children){this.children=children;}});return elements.get(id);}
 const context=vm.createContext({resolvePlaylistSeek,readPlaylistSeekDuration:readDuration|| (async()=>20),createNextClipPreloader,shouldPreloadNext,prepareNextClip:prepare|| (async()=>null),installKeyboardControls,createPlaylistEntries,sortPlaylistEntries,PLAYLIST_SORTS,AbortController,createPlaylistBrowser:()=>({render(){},close(){}}),readPlaylistMetadata:async()=>({}),createPlaylistThumbnail:async()=>null,document:{getElementById:el,createElement:()=>({})},window:{addEventListener(name,fn){windowHandlers[name]=fn;}},URL:{createObjectURL:value=>{createdObjects.push(value);return `blob:${Math.random()}`;},revokeObjectURL:url=>revoked.push(url)},createRenderer:()=>({setSource(value){sources.push(value);},setMaxSources(){}}),demoPanorama:()=>({}),formatTime:String,inspectFile:inspect|| (async()=>({nativeCandidate:true,tracks:[]})),createNativePlayer:create|| (async(file,options)=>{const player={file,options,playing:false,duration:file.duration??20,audioState:{available:true,modes:['stereo','ambisonic'],mode:'stereo'},setAudioMode(mode){this.audioState.mode=mode;},setMuted(value){this.muted=value;},setVolume(value){this.volume=value;},play(){this.playing=true;return Promise.resolve();},pause(){this.playing=false;},seek(value){this.lastSeek=value;},close(){this.closed=true;}};players.push(player);return player;})});
 vm.runInContext(source,context);
 return {context,el,players,revoked,createdObjects,sources,windowHandlers};
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

test('sorting changes real transport order while preserving the current clip and added numbers',async()=>{
 const {context:c,el,players}=setup();
 const input=[{name:'clip10.360',size:100},{name:'clip2.360',size:300},{name:'clip1.360',size:200}];
 await c.setPlaylist(input);const current=players[0];
 c.sortPlaylist('name',false);
 assert.equal(players.length,1);assert.equal(players[0],current);assert.equal(el('playlist-position').textContent,'3 / 3');
 assert.deepEqual(el('playlist-select').children.map(x=>x.textContent),['3. clip1.360','2. clip2.360','1. clip10.360']);
 c.sortPlaylist('size',true);assert.equal(el('playlist-position').textContent,'3 / 3');
 await c.selectClip(0,true);players.at(-1).options.onState({playing:false,currentTime:20,duration:20});await flush();
 assert.equal(players.at(-1).file.name,'clip1.360');assert.equal(players.at(-1).playing,true);
 c.sortPlaylist('added',false);assert.equal(el('playlist-position').textContent,'3 / 3');
});
test('date sorting places unknowns last in both directions and never substitutes modified dates',async()=>{
 const {context:c,el}=setup();await c.setPlaylist(files);await flush();
 vm.runInContext('playlist[0].dateTaken=200;playlist[1].dateTaken=null;playlist[2].dateTaken=100;',c);
 c.sortPlaylist('dateTaken',false);assert.deepEqual(el('playlist-select').children.map(x=>x.textContent),['3. three.360','1. one.360','2. two.360']);
 c.sortPlaylist('dateTaken',true);assert.deepEqual(el('playlist-select').children.map(x=>x.textContent),['1. one.360','3. three.360','2. two.360']);
 c.sortPlaylist('fileCreated',true);assert.deepEqual(el('playlist-select').children.map(x=>x.textContent),['1. one.360','2. two.360','3. three.360']);
});
test('playlist selection uses stable ID after sort, starts playback, and ignores IDs from a replaced queue',async()=>{
 const {context:c,players}=setup();await c.setPlaylist(files);const id=vm.runInContext('playlist[1].id',c);
 c.sortPlaylist('size',true);await c.selectPlaylistItem(id);assert.equal(players.at(-1).file.name,'two.360');assert.equal(players.at(-1).playing,true);
 await c.setPlaylist([files[0]]);const count=players.length;await c.selectPlaylistItem(id);assert.equal(players.length,count);
});
test('confirmed equirectangular projection survives switching away and back',async()=>{
 const {context:c,el}=setup({inspect:async()=>({tracks:[],videoTracks:[{}]})});await c.setPlaylist(files);
 el('equirect').emit('click');await c.selectClip(1);assert.equal(el('equirect').hidden,false);
 await c.selectClip(0);assert.equal(el('equirect').hidden,true);assert.match(el('status').textContent,/Loading local video/);
});

const settlePreload=()=>new Promise(resolve=>setImmediate(resolve));
const nativeInfo={nativeCandidate:true,tracks:[],videoTracks:[{},{}]};
function warmResult(extra={}){return {info:nativeInfo,movie:{prepared:true},closed:0,close(){this.closed++;},...extra};}
function advancing(player,currentTime=10,extra={}){player.options.onState({playing:true,buffering:false,preparing:false,currentTime,duration:20,...extra});}
function ended(player){player.options.onState({playing:false,currentTime:20,duration:20});}
test('natural native EOF adopts warmed successor without a second standby player or demo flash',async()=>{
 const warm=warmResult(),calls=[];const h=setup({prepare:async(file,options)=>{calls.push({file,options});return warm;}});
 await h.context.setPlaylist(files);advancing(h.players[0],4);await settlePreload();assert.equal(calls.length,0);
 advancing(h.players[0]);await settlePreload();assert.equal(calls.length,1);assert.equal(calls[0].file,files[1]);assert.equal(h.players.length,1);
 h.el('muted').checked=false;h.el('muted').emit('change');const sourceCount=h.sources.length;ended(h.players[0]);assert.equal(h.players.length,1,'handoff leaves decoder callback before closing frames');await settlePreload();
 assert.equal(h.players.length,2);assert.equal(h.players[1].options.preparedMovie,warm.movie);assert.equal(h.players[1].playing,true);assert.equal(h.players[1].muted,false);assert.equal(h.players[0].closed,true);assert.equal(warm.closed,0,'movie ownership belongs to successor now');assert.equal(h.sources.length,sourceCount,'hold last texture instead of replacing it with demo');
});
test('manual Next or gallery selection discards warmed data and retains ordinary selection behavior',async()=>{
 for(const gallery of [false,true]){
  const warm=warmResult(),h=setup({prepare:async()=>warm});await h.context.setPlaylist(files);advancing(h.players[0]);await settlePreload();
  if(gallery)await h.context.selectPlaylistItem(vm.runInContext('playlist[1].id',h.context));else await h.context.selectClip(1,true);
  assert.equal(warm.closed,1);assert.equal(h.players[1].options.preparedMovie,undefined);assert.equal(h.players[1].playing,true);assert.equal(h.players[1].file,files[1]);
 }
});
test('sorting retargets by stable identity and only the newly ordered successor is adopted',async()=>{
 const prepared=[];const h=setup({prepare:async file=>{const value=warmResult();prepared.push({file,value});return value;}});
 const input=[{name:'duplicate.360',size:100},{name:'duplicate.360',size:300},{name:'last.360',size:200}];await h.context.setPlaylist(input);advancing(h.players[0]);await settlePreload();
 h.context.sortPlaylist('size',false);await settlePreload();assert.equal(prepared[0].value.closed,1);assert.equal(prepared[1].file,input[2]);assert.equal(h.players.length,1);
 ended(h.players[0]);await settlePreload();assert.equal(h.players[1].file,input[2]);assert.equal(h.players[1].options.preparedMovie,prepared[1].value.movie);
});
test('EOF uses ordinary load immediately if warmup is pending, and late readiness is closed',async()=>{
 let resolve;const h=setup({prepare:()=>new Promise(r=>resolve=r)});await h.context.setPlaylist(files);advancing(h.players[0]);await settlePreload();
 ended(h.players[0]);await settlePreload();assert.equal(h.players.length,2);assert.equal(h.players[1].options.preparedMovie,undefined);assert.equal(h.players[1].playing,true);
 const stale=warmResult();resolve(stale);await settlePreload();assert.equal(stale.closed,1);assert.equal(h.players.length,2);
});
test('failed speculation is silent, attempted once, and retried through ordinary opening at EOF',async()=>{
 let attempts=0,inspections=0;const h=setup({inspect:async()=>{inspections++;return nativeInfo;},prepare:async()=>{attempts++;throw Error('temporary disk error');}});await h.context.setPlaylist(files);const before=h.el('status').textContent;
 advancing(h.players[0]);await settlePreload();advancing(h.players[0],11);await settlePreload();assert.equal(attempts,1);assert.equal(h.el('status').textContent,before);assert.equal(h.el('play').disabled,false);
 ended(h.players[0]);await settlePreload();assert.equal(inspections,2);assert.equal(h.players[1].playing,true);
});
test('pause, decoder stall, manual seek, replacement, demo and page disposal release speculation',async()=>{
 for(const mode of ['pause','buffer','seek','replace','demo','pagehide']){
  const warm=warmResult(),h=setup({prepare:async()=>warm});await h.context.setPlaylist(files);advancing(h.players[0]);await settlePreload();
  if(mode==='pause')advancing(h.players[0],10,{playing:false});
  if(mode==='buffer')advancing(h.players[0],10,{buffering:true});
  if(mode==='seek')h.context.seekRelative(1);
  if(mode==='replace')await h.context.setPlaylist([files[2]]);
  if(mode==='demo')h.el('demo').emit('click');
  if(mode==='pagehide')h.windowHandlers.pagehide();
  assert.equal(warm.closed,1,mode);await settlePreload();
 }
});
test('seek discards old preparation but advancing past the new position can prepare a fresh successor',async()=>{
 const results=[],h=setup({prepare:async()=>{const value=warmResult();results.push(value);return value;}});await h.context.setPlaylist(files);advancing(h.players[0]);await settlePreload();h.context.seekRelative(1);
 assert.equal(results[0].closed,1);advancing(h.players[0],11);await settlePreload();assert.equal(results.length,1);advancing(h.players[0],11.25);await settlePreload();assert.equal(results.length,2);
});
test('confirmed equirectangular EOF uses warmed bytes without a hidden playback element',async()=>{
 const blob={localPreparedBlob:true},info={tracks:[],videoTracks:[{}]},warm=warmResult({info,movie:undefined,blob}),calls=[];
 const h=setup({inspect:async()=>info,prepare:async(file,options)=>{calls.push({file,options});return warm;}});
 await h.context.setPlaylist(files.slice(0,2));h.el('equirect').emit('click');await h.context.selectClip(1);h.el('equirect').emit('click');await h.context.selectClip(0);
 const video=h.el('video');Object.assign(video,{readyState:3,duration:20,currentTime:10,ended:false,paused:false});video.emit('timeupdate');await settlePreload();assert.equal(calls.length,1);assert.equal(calls[0].options.confirmed,true);assert.equal(h.players.length,0);
 video.ended=true;video.emit('ended');await settlePreload();assert.equal(h.createdObjects.at(-1),blob);assert.equal(h.el('equirect').hidden,true);assert.equal(warm.closed,1);
 video.readyState=2;video.emit('loadeddata');await settlePreload();assert.equal(video.paused,false);
});
test('unconfirmed browser successor still requires projection approval after metadata preloading',async()=>{
 const info={tracks:[],videoTracks:[{}]},calls=[],h=setup({inspect:async()=>info,prepare:async(file,options)=>{calls.push(options);return warmResult({info,movie:undefined});}});
 await h.context.setPlaylist(files.slice(0,2));h.el('equirect').emit('click');const video=h.el('video');Object.assign(video,{readyState:3,duration:20,currentTime:10,ended:false,paused:false});video.emit('timeupdate');await settlePreload();assert.equal(calls[0].confirmed,false);
 video.ended=true;video.emit('ended');await settlePreload();assert.equal(h.el('equirect').hidden,false);assert.equal(h.createdObjects.length,1);h.el('equirect').emit('click');video.readyState=2;video.emit('loadeddata');await settlePreload();assert.equal(video.paused,false);
});
test('last item, stale callbacks and newly replaced queues cannot preload an old successor',async()=>{
 const calls=[],h=setup({prepare:async file=>{calls.push(file);return warmResult();}});await h.context.setPlaylist(files);const old=h.players[0];await h.context.setPlaylist([files[2]]);advancing(old);advancing(h.players[1]);await settlePreload();assert.equal(calls.length,0);ended(h.players[1]);await settlePreload();assert.equal(h.players.length,2);
});
test('browser pause cannot restart speculation through a later sort; seek and wait cancel before rearming',async()=>{
 const info={tracks:[],videoTracks:[{}]},values=[],h=setup({inspect:async()=>info,prepare:async()=>{const result=warmResult({info,movie:undefined});values.push(result);return result;}});
 await h.context.setPlaylist(files);h.el('equirect').emit('click');const video=h.el('video');Object.assign(video,{readyState:3,duration:20,currentTime:10,ended:false,paused:false});video.emit('timeupdate');await settlePreload();assert.equal(values.length,1);
 video.paused=true;video.emit('pause');h.context.sortPlaylist('added',false);await settlePreload();assert.equal(values.length,1);assert.equal(values[0].closed,1);
 video.paused=false;video.emit('timeupdate');await settlePreload();assert.equal(values.length,2);video.currentTime=12;video.seeking=true;video.emit('seeking');video.emit('timeupdate');await settlePreload();assert.equal(values[1].closed,1);assert.equal(values.length,2);
 video.seeking=false;video.currentTime=12.25;video.emit('timeupdate');await settlePreload();assert.equal(values.length,3);video.emit('waiting');h.context.sortPlaylist('added',false);await settlePreload();assert.equal(values[2].closed,1);assert.equal(values.length,3);
});
test('page visibility cancels ready input and suppresses new speculative requests while hidden',async()=>{
 const values=[],h=setup({prepare:async()=>{const result=warmResult();values.push(result);return result;}});await h.context.setPlaylist(files);advancing(h.players[0]);await settlePreload();assert.equal(values.length,1);
 h.context.document.hidden=true;h.context.updateNextPreload();advancing(h.players[0],11);await settlePreload();assert.equal(values[0].closed,1);assert.equal(values.length,1);
 h.context.document.hidden=false;advancing(h.players[0],12);await settlePreload();assert.equal(values.length,2);
});

function position(h,time,playing=false){
 const player=h.players.at(-1);player.playing=playing;
 player.options.onState({playing,currentTime:time,duration:player.duration});
}
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
test('relative native seeks carry overshoot both ways and retain paused/playing intent',async()=>{
 for(const playing of [false,true]){
  const h=setup();await h.context.setPlaylist(files);position(h,18,playing);
  await h.context.seekRelative(5);assert.equal(h.players.at(-1).file,files[1]);assert.equal(h.players.at(-1).options.initialTime,3);assert.equal(h.players.at(-1).playing,playing);assert.equal(h.players[0].closed,true);
  position(h,2,playing);await h.context.seekRelative(-5);
  assert.equal(h.players.at(-1).file,files[0]);assert.equal(h.players.at(-1).options.initialTime,17);assert.equal(h.players.at(-1).playing,playing);
 }
});
test('relative seeks follow the sorted queue, traverse multiple clips, and never wrap',async()=>{
 const h=setup();await h.context.setPlaylist(files);h.context.sortPlaylist('size',true);position(h,2);
 await h.context.seekRelative(-25);assert.equal(h.players.at(-1).file,files[2]);assert.equal(h.players.at(-1).options.initialTime,17);
 await h.context.seekRelative(-1000);assert.equal(h.players.at(-1).file,files[2]);assert.equal(h.players.at(-1).lastSeek,0);
 await h.context.seekRelative(1000);assert.equal(h.players.at(-1).file,files[0]);assert.equal(h.players.at(-1).lastSeek,20);
});
test('exact endpoints choose the next beginning but final endpoint stays paused',async()=>{
 const h=setup();await h.context.setPlaylist(files);position(h,15);
 await h.context.seekRelative(5);assert.equal(h.players.at(-1).file,files[1]);assert.equal(h.players.at(-1).options.initialTime,0);assert.equal(h.players.at(-1).playing,false);
 position(h,5);await h.context.seekRelative(-5);assert.equal(h.players.at(-1).file,files[1]);assert.equal(h.players.at(-1).lastSeek,0);
 await h.context.seekRelative(40);assert.equal(h.players.at(-1).file,files[2]);assert.equal(h.players.at(-1).lastSeek,20);assert.equal(h.players.at(-1).playing,false);
});
test('new relative input samples the live native clock after natural playback advances',async()=>{
 const h=setup();await h.context.setPlaylist(files);position(h,1,true);
 h.players[0].currentTime=18;await h.context.seekRelative(5);
 assert.equal(h.players.at(-1).file,files[1]);assert.equal(h.players.at(-1).options.initialTime,3);
 position(h,3,true);h.players.at(-1).currentTime=10;h.context.seekRelative(5);assert.equal(h.players.at(-1).lastSeek,15);
});
test('held input coalesces while duration is unknown, without competing decoder creation',async()=>{
 const waiting=gate(),calls=[],h=setup({readDuration:async file=>{calls.push(file);await waiting.promise;return 20;}});
 await h.context.setPlaylist(files);position(h,18,true);
 const pending=h.context.seekRelative(5);await settlePreload();assert.equal(h.players.length,1);assert.equal(h.players[0].playing,false);
 h.context.seekRelative(5);h.context.seekRelative(5);h.context.seekRelative(-5);
 assert.equal(h.context.canSeekRelative(),true);waiting.resolve();await pending;
 assert.equal(h.players.length,2);assert.equal(h.players.at(-1).file,files[1]);assert.equal(h.players.at(-1).options.initialTime,8);assert.equal(h.players.at(-1).playing,true);assert.equal(calls.length,1);
});
test('repeat and reversal during destination loading are applied before playback resumes',async()=>{
 const waiting=gate(),h=setup({inspect:async file=>{if(file===files[1])await waiting.promise;return nativeInfo;}});
 await h.context.setPlaylist(files);position(h,18,true);
 const pending=h.context.seekRelative(5);await settlePreload();h.context.seekRelative(5);h.context.seekRelative(-15);waiting.resolve();await pending;
 assert.equal(h.players.at(-1).file,files[0]);assert.equal(h.players.at(-1).options.initialTime,13);assert.equal(h.players.at(-1).playing,true);
 assert.equal(h.players[1].playing,false,'intermediate destination must never autoplay');
});
test('play/pause during a pending seek controls only its final playback intent',async()=>{
 const waiting=gate(),h=setup({readDuration:()=>waiting.promise});await h.context.setPlaylist(files);position(h,18,true);
 const pending=h.context.seekRelative(5);await settlePreload();await h.context.togglePlayback();waiting.resolve(20);await pending;
 assert.equal(h.players.at(-1).playing,false);
});
test('manual selection, sorting, replacement, absolute seeking and demo cancel stale duration work',async()=>{
 for(const action of ['select','sort','replace','absolute','demo']){
  const waiting=gate(),h=setup({readDuration:()=>waiting.promise});await h.context.setPlaylist(files);position(h,18);
  const pending=h.context.seekRelative(5);await settlePreload();
  if(action==='select')await h.context.selectClip(2,false);
  if(action==='sort')h.context.sortPlaylist('size',true);
  if(action==='replace')await h.context.setPlaylist([files[2]]);
  if(action==='absolute'){h.el('seek').value=500;h.el('seek').emit('input');}
  if(action==='demo')h.el('demo').emit('click');
  const count=h.players.length,name=h.el('filename').textContent;waiting.resolve(20);await pending;
  assert.equal(h.players.length,count,action);assert.equal(h.el('filename').textContent,name,action);
  if(action==='absolute')assert.equal(h.players[0].lastSeek,10);
 }
});
test('manual selection while seek destination opens rejects late readiness without autoplay',async()=>{
 const waiting=gate(),h=setup({inspect:async file=>{if(file===files[1])await waiting.promise;return nativeInfo;}});
 await h.context.setPlaylist(files);position(h,18,true);const pending=h.context.seekRelative(5);await settlePreload();
 await h.context.selectClip(2,false);waiting.resolve();await pending;await flush();
 assert.equal(h.players.at(-1).file,files[2]);assert.equal(h.players.at(-1).playing,false);assert.equal(h.players.length,2);
});
test('unknown duration failure preserves original position and playing state',async()=>{
 const h=setup({readDuration:async()=>{throw Error('metadata unavailable');}});await h.context.setPlaylist(files);position(h,18,true);
 await h.context.seekRelative(5);assert.equal(h.players.length,1);assert.equal(h.players[0].closed,undefined);assert.equal(h.players[0].playing,true);assert.match(h.el('status').textContent,/metadata unavailable.*original position/);
});
test('destination open failure restores the original clip and exact position',async()=>{
 const h=setup({inspect:async file=>{if(file===files[1])throw Error('decoder failure');return nativeInfo;}});await h.context.setPlaylist(files);position(h,18,true);
 await h.context.seekRelative(5);assert.equal(h.players.at(-1).file,files[0]);assert.equal(h.players.at(-1).options.initialTime,18);assert.equal(h.players.at(-1).playing,true);assert.match(h.el('status').textContent,/Seeking failed.*original position/);
});
test('queued natural EOF cannot override a newer relative seek',async()=>{
 const h=setup();await h.context.setPlaylist(files);position(h,20);h.context.seekRelative(-5);await flush();
 assert.equal(h.players.length,1);assert.equal(h.players[0].lastSeek,15);
});
test('paused seeks to the end never trigger native EOF auto-advance',async()=>{
 const h=setup();await h.context.setPlaylist(files);position(h,18);const pending=h.context.seekRelative(25);await flush();await pending;
 const last=h.players.at(-1);assert.equal(last.file,files[2]);assert.equal(last.playing,false);assert.equal(last.options.initialTime,3);
});
test('browser crossing keeps projection confirmation and applies overshoot before play',async()=>{
 const info={tracks:[],videoTracks:[{}]},h=setup({inspect:async()=>info});await h.context.setPlaylist(files);
 h.el('equirect').emit('click');const video=h.el('video');Object.assign(video,{currentTime:18,duration:20,readyState:2,videoWidth:200,videoHeight:100,paused:true});video.emit('loadeddata');await h.context.togglePlayback();
 const pending=h.context.seekRelative(5);await settlePreload();assert.equal(h.el('equirect').hidden,false);assert.equal(video.paused,true);
 h.el('equirect').emit('click');video.currentTime=0;video.emit('loadedmetadata');assert.equal(video.currentTime,3);video.readyState=2;video.emit('loadeddata');await pending;
 assert.equal(video.currentTime,3);assert.equal(video.paused,false);
});
test('browser pending consent can be canceled by newer selection without later playback',async()=>{
 const info={tracks:[],videoTracks:[{}]},h=setup({inspect:async()=>info});await h.context.setPlaylist(files);h.el('equirect').emit('click');const video=h.el('video');Object.assign(video,{currentTime:18,duration:20,readyState:2});video.emit('loadeddata');
 const pending=h.context.seekRelative(5);await settlePreload();await h.context.selectClip(2,false);await pending;h.el('equirect').emit('click');video.readyState=2;video.emit('loadeddata');await flush();
 assert.equal(h.el('filename').textContent,files[2].name);assert.equal(video.paused,true);
});

test('reversing away from pending browser consent does not require confirming the abandoned clip',async()=>{
 const info={tracks:[],videoTracks:[{}]},h=setup({inspect:async()=>info});await h.context.setPlaylist(files);h.el('equirect').emit('click');const video=h.el('video');Object.assign(video,{currentTime:18,duration:20,readyState:2});video.emit('loadeddata');
 const pending=h.context.seekRelative(5);await settlePreload();assert.equal(h.el('filename').textContent,files[1].name);assert.equal(h.el('equirect').hidden,false);
 h.context.seekRelative(-10);await settlePreload();assert.equal(h.el('filename').textContent,files[0].name);assert.equal(h.el('equirect').hidden,true);
 video.currentTime=0;video.emit('loadedmetadata');video.readyState=2;video.emit('loadeddata');await pending;assert.equal(video.currentTime,13);assert.equal(video.paused,true);
});
test('continued held input can skip past an unconfirmed browser destination without approving it',async()=>{
 const info={tracks:[],videoTracks:[{}]},h=setup({inspect:async()=>info});await h.context.setPlaylist(files);h.el('equirect').emit('click');const video=h.el('video');Object.assign(video,{currentTime:18,duration:20,readyState:2});video.emit('loadeddata');
 const pending=h.context.seekRelative(5);await settlePreload();h.context.seekRelative(20);await settlePreload();assert.equal(h.el('filename').textContent,files[2].name);assert.equal(h.el('equirect').hidden,false);
 h.el('equirect').emit('click');video.currentTime=0;video.emit('loadedmetadata');video.readyState=2;video.emit('loadeddata');await pending;assert.equal(video.currentTime,3);assert.equal(video.paused,true);
});

test('reversal during inspection replans when the stale destination reaches projection consent',async()=>{
 const info={tracks:[],videoTracks:[{}]},waiting=gate(),h=setup({inspect:async file=>{if(file===files[1])await waiting.promise;return info;}});await h.context.setPlaylist(files);h.el('equirect').emit('click');const video=h.el('video');Object.assign(video,{currentTime:18,duration:20,readyState:2});video.emit('loadeddata');
 const pending=h.context.seekRelative(5);await settlePreload();h.context.seekRelative(-10);waiting.resolve();await settlePreload();
 assert.equal(h.el('filename').textContent,files[0].name);assert.equal(h.el('equirect').hidden,true);
 video.currentTime=0;video.emit('loadedmetadata');video.readyState=2;video.emit('loadeddata');await pending;assert.equal(video.currentTime,13);assert.equal(video.paused,true);
});


test('zero-duration current and intermediate entries cannot trap playlist seeking',async()=>{
 const input=[{name:'zero.360',size:10,duration:0},{name:'empty.360',size:20,duration:0},{name:'last.360',size:30,duration:20}];
 const h=setup({readDuration:async file=>file.duration});await h.context.setPlaylist(input);position(h,0);
 await h.context.seekRelative(5);assert.equal(h.players.at(-1).file,input[2]);assert.equal(h.players.at(-1).options.initialTime,5);assert.equal(h.players.at(-1).playing,false);
});
