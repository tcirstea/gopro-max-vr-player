import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('native diagnostics stay local and source changes clear buffering and diagnostics UI',async()=>{
 const elements=new Map(),downloads=[],revoked=[],timers=[];let callbacks,closed=0;
 function element(id){if(!elements.has(id))elements.set(id,{textContent:'',hidden:false,value:0,checked:true,handlers:{},addEventListener(name,fn){this.handlers[name]=fn;},canPlayType(){return '';},pause(){},load(){},removeAttribute(){}});return elements.get(id);}
 const snapshot={version:1,presentedPairs:4,buffering:true,tracks:[{codec:'hvc1.1.6.L153',decoded:8}]};
 const player={playing:true,duration:20,close(){closed++;},getDiagnostics(){return snapshot;}};
 const document={getElementById:element,body:{append(){}},createElement(){return {click(){downloads.push({name:this.download,url:this.href});},remove(){}};}};
 let exported;
 const context=vm.createContext({document,window:{addEventListener(){}},Blob,URL:{createObjectURL(blob){exported=blob;return 'blob:local-report';},revokeObjectURL(url){revoked.push(url);}},setTimeout(fn){timers.push(fn);},createRenderer:()=>({setSource(){},setMaxSources(){},reset(){}}),demoPanorama:()=>({}),formatTime:n=>`${n}`,inspectFile:async()=>({nativeCandidate:true,brand:'test',tracks:[]}),createNativePlayer:async(file,options)=>{callbacks=options;return player;}});
 const source=readFileSync(new URL('../src/app.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
 vm.runInContext(source,context);
 await context.openFile({name:'PRIVATE-FOOTAGE.360',size:100});
 assert.equal(element('diagnostics-panel').hidden,false);
 const generalStatus=element('status').textContent;
 callbacks.onState({playing:true,buffering:true,preparing:true,currentTime:0,duration:20});
 assert.match(element('playback-state').textContent,/Preparing this short clip/);
 callbacks.onState({playing:true,buffering:true,currentTime:1,duration:20});
 assert.match(element('playback-state').textContent,/Buffering paired/);
 assert.equal(element('status').textContent,generalStatus);
 element('download-diagnostics').handlers.click();
 assert.deepEqual(downloads,[{name:'max-playback-diagnostics.json',url:'blob:local-report'}]);
 const text=await exported.text(),report=JSON.parse(text);
 assert.deepEqual(report.playback,snapshot);
 assert.equal(text.includes('PRIVATE-FOOTAGE'),false);
 timers.forEach(fn=>fn());assert.deepEqual(revoked,['blob:local-report']);
 element('demo').handlers.click();
 assert.equal(closed,1);assert.equal(element('diagnostics-panel').hidden,true);assert.equal(element('playback-state').hidden,true);
 callbacks.onState({playing:true,buffering:true,currentTime:4,duration:20});
 assert.equal(element('playback-state').hidden,true,'stale native callbacks cannot restore buffering UI');
 element('download-diagnostics').handlers.click();assert.equal(downloads.length,1);
});
