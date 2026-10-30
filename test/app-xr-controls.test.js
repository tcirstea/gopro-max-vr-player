import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function harness(native=true){
 const elements=new Map(),seeks=[];let callbacks,played=0,paused=0;
 function element(id){if(!elements.has(id))elements.set(id,{textContent:'',hidden:false,disabled:['play','seek'].includes(id),value:0,checked:true,paused:true,currentTime:0,duration:20,handlers:{},addEventListener(name,fn){this.handlers[name]=fn;},canPlayType(){return '';},async play(){this.paused=false;played++;},pause(){this.paused=true;paused++;},load(){},removeAttribute(){},replaceChildren(){}});return elements.get(id);}
 const player={setMuted(){},setVolume(){},playing:false,duration:20,close(){},seek(t){seeks.push(t);},async play(){this.playing=true;played++;},pause(){this.playing=false;paused++;}};
 const context=vm.createContext({document:{getElementById:element},window:{addEventListener(){}},URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},createRenderer:()=>({setSource(){},reset(){}}),demoPanorama:()=>({}),formatTime:n=>`${n}`,inspectFile:async()=>({nativeCandidate:native,brand:'test',tracks:[],videoTracks:[{}]}),createNativePlayer:async(file,options)=>{callbacks=options;return player;}});
 const source=readFileSync(new URL('../src/app.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');vm.runInContext(source,context);
 return {element,context,player,seeks,get callbacks(){return callbacks;},get played(){return played;},get paused(){return paused;},seek:delta=>element('canvas').handlers.xrseek({detail:delta}),toggle:()=>element('canvas').handlers.xrtoggleplay()};
}
test('XR native transport toggles playback, uses latest state, clamps and accumulates seeks',async()=>{
 const h=harness();await h.toggle();assert.equal(h.played,0);h.seek(5);assert.deepEqual(h.seeks,[]);
 await h.context.openFile({name:'test.360',size:100});assert.doesNotMatch(h.element('status').textContent,/Cannot open/);await h.toggle();assert.equal(h.player.playing,true);await h.toggle();assert.equal(h.player.playing,false);
 h.callbacks.onState({playing:false,currentTime:7,duration:20});h.seek(5);h.seek(5);h.seek(5);h.seek(-100);
 assert.deepEqual(h.seeks,[12,17,20,0]);
 h.element('demo').handlers.click();h.seek(5);await h.toggle();assert.deepEqual(h.seeks,[12,17,20,0]);assert.equal(h.played,1);
});
test('XR equirectangular transport toggles and clamps seeks; invalid duration is ignored',async()=>{
 const h=harness(false);await h.context.openFile({name:'test.mp4',size:100});h.element('equirect').handlers.click();h.element('video').handlers.loadeddata();
 await h.toggle();assert.equal(h.element('video').paused,false);await h.toggle();assert.equal(h.element('video').paused,true);
 h.element('video').currentTime=18;h.seek(5);assert.equal(h.element('video').currentTime,20);h.seek(-100);assert.equal(h.element('video').currentTime,0);
 h.element('video').duration=Infinity;h.seek(5);assert.equal(h.element('video').currentTime,0);
});
test('XR transport reports decoder/play failures without an unhandled rejection',async()=>{
 const h=harness();await h.context.openFile({name:'test.360',size:100});assert.doesNotMatch(h.element('status').textContent,/Cannot open/);h.player.play=async()=>{throw Error('autoplay');};await h.toggle();assert.match(h.element('status').textContent,/Playback blocked: autoplay/);
 h.player.seek=()=>{throw Error('decoder');};h.seek(5);assert.match(h.element('status').textContent,/Seeking failed: decoder/);
});

test('VR session errors are not mislabeled as unavailable video textures',()=>{
 const h=harness();h.element('canvas').handlers.xrerror({detail:'There is already an active, immersive XRSession.'});
 assert.match(h.element('status').textContent,/^VR unavailable:/);
 assert.match(h.element('status').textContent,/Desktop playback is still available/);
 assert.doesNotMatch(h.element('status').textContent,/Video texture unavailable/);
});
