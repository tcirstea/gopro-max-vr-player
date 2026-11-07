import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installKeyboardControls} from '../src/keyboard-controls.js';
function harness(){
 const handlers={},docHandlers={},intervals=new Map(),seeks=[];let plays=0,reveals=0,play=true,seek=true,id=0;
 const target={addEventListener:(n,f)=>handlers[n]=f,removeEventListener:n=>delete handlers[n]};
 const doc={hidden:false,activeElement:null,modal:false,querySelector(){return this.modal;},addEventListener:(n,f)=>docHandlers[n]=f,removeEventListener:n=>delete docHandlers[n]};
 const dispose=installKeyboardControls({target,document:doc,togglePlayback:()=>plays++,seek:s=>seeks.push(s),revealControls:()=>reveals++,canPlay:()=>play,canSeek:()=>seek,setInterval(f,ms){assert.equal(ms,500);intervals.set(++id,f);return id;},clearInterval:id=>intervals.delete(id)});
 function key(key,extra={},type='keydown'){const e={key,prevented:false,preventDefault(){this.prevented=true;},...extra};handlers[type](e);return e;}
 return {handlers,docHandlers,doc,intervals,seeks,key,dispose,tick(){for(const f of intervals.values())f();},get plays(){return plays;},get reveals(){return reveals;},set enabled(v){play=seek=v;}};
}
test('Space toggles once per press and consumes repeat without native activation',()=>{
 const h=harness();assert.ok(h.key(' ').prevented);h.key(' ');h.key(' ',{repeat:true});assert.equal(h.plays,1);assert.equal(h.reveals,1);
 assert.ok(h.key(' ',{},'keyup').prevented);h.key(' ');assert.equal(h.plays,2);
});
test('arrows seek immediately then once each 500 ms, independently of OS repeat',()=>{
 const h=harness();assert.ok(h.key('ArrowRight').prevented);h.key('ArrowRight',{repeat:true});assert.deepEqual(h.seeks,[5]);h.tick();h.tick();assert.deepEqual(h.seeks,[5,5,5]);
 h.key('ArrowLeft');assert.equal(h.intervals.size,1);h.key('ArrowRight',{},'keyup');h.tick();assert.deepEqual(h.seeks,[5,5,5,-5,-5]);h.key('ArrowLeft',{},'keyup');h.tick();assert.equal(h.intervals.size,0);assert.equal(h.reveals,5);
});
test('form fields, nested editable elements, buttons and dialogs keep native keys',()=>{
 const h=harness();
 for(const name of ['input','textarea','select','button','summary','dialog','[role="slider"]','[role="button"]','[role="dialog"]','[contenteditable]']){
  const target={closest(selector){assert.ok(selector.includes(name==='[contenteditable]'?'[contenteditable]':name));return {};}};
  for(const key of [' ','ArrowLeft','ArrowRight'])assert.equal(h.key(key,{target}).prevented,false);
 }
 h.doc.activeElement={isContentEditable:true};h.key(' ');h.doc.activeElement=null;
 h.key(' ',{composedPath:()=>[{isContentEditable:true},{}]});h.doc.modal=true;h.key(' ');assert.equal(h.plays,0);assert.deepEqual(h.seeks,[]);
});
test('unrelated, modified, composing, already-handled and unavailable transport keys are untouched',()=>{
 const h=harness();for(const key of ['ArrowUp','ArrowDown','+','-','Enter','Escape','a'])assert.equal(h.key(key).prevented,false);
 for(const flag of ['altKey','ctrlKey','metaKey','shiftKey','isComposing','defaultPrevented'])for(const key of [' ','ArrowLeft'])assert.equal(h.key(key,{[flag]:true}).prevented,false);
 h.enabled=false;for(const key of [' ','ArrowLeft'])assert.equal(h.key(key).prevented,false);assert.equal(h.plays,0);assert.deepEqual(h.seeks,[]);
});
test('holds stop on focus, page or visibility changes and do not resume on repeat events',()=>{
 for(const event of ['blur','pagehide','focusin','visibilitychange']){
  const h=harness();h.key('ArrowRight');h.key(' ');(h.handlers[event]||h.docHandlers[event])();assert.equal(h.intervals.size,0);
  h.key('ArrowRight',{repeat:true});h.key(' ',{repeat:true});assert.equal(h.plays,1);assert.deepEqual(h.seeks,[5]);h.key('ArrowLeft');assert.deepEqual(h.seeks,[5,-5]);h.dispose();assert.equal(h.intervals.size,0);assert.deepEqual(h.handlers,{});
 }
});
test('repeat rechecks live transport, dialog and focus state; modifiers cancel a hold',()=>{
 for(const change of [h=>h.enabled=false,h=>h.doc.modal=true,h=>h.doc.hidden=true,h=>h.doc.activeElement={isContentEditable:true},h=>h.key('Control',{ctrlKey:true})]){
  const h=harness();h.key('ArrowLeft');change(h);h.tick();assert.deepEqual(h.seeks,[-5]);assert.equal(h.intervals.size,0);
 }
});

test('on-page control help matches keyboard, mouse and bumper behavior',async()=>{
 const {readFileSync}=await import('node:fs');
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/Space plays or pauses/);assert.match(html,/Left and right arrows seek five seconds/);
 assert.match(html,/Left mouse drag/);assert.match(html,/Right mouse drag horizontally rolls the view/);assert.match(html,/Middle click resets zoom/);
 assert.match(html,/aiming away from the panel to hide it/);assert.match(html,/current video’s page/);
 assert.doesNotMatch(html,/Arrow keys to (rotate|turn)/);
});
