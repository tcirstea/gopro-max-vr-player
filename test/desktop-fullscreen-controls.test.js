import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {installDesktopFullscreenControls} from '../src/desktop-fullscreen-controls.js';

// Synthetic DOM and fake timers: no browser, media, real timers, or private files.
function harness(){
  let now=0,serial=0;const timers=new Map(),ids=new Map();
  class Node {
    constructor(id){this.id=id;this.children=[];this.listeners=new Map();this.attributes={};this.classes=new Set();this.classList={add:(...v)=>v.forEach(x=>this.classes.add(x)),remove:(...v)=>v.forEach(x=>this.classes.delete(x)),contains:v=>this.classes.has(v)};if(id)ids.set(id,this);}
    addEventListener(name,fn,capture=false){const list=this.listeners.get(name)||[];list.push({fn,capture:!!capture});this.listeners.set(name,list);}
    removeEventListener(name,fn){this.listeners.set(name,(this.listeners.get(name)||[]).filter(item=>item.fn!==fn));}
    append(node){node.remove();node.parent=this;this.children.push(node);}
    remove(){this.modal=false;if(this.parent){this.parent.children.splice(this.parent.children.indexOf(this),1);this.parent=null;}}
    before(node){node.remove();node.parent=this.parent;this.parent.children.splice(this.parent.children.indexOf(this),0,node);}
    replaceWith(node){const parent=this.parent;node.remove();const index=parent.children.indexOf(this);parent.children.splice(index,1,node);node.parent=parent;this.parent=null;}
    contains(node){for(let n=node;n;n=n.parent)if(n===this)return true;return false;}
    querySelector(selector){return selector==='.viewer-bottom'?ids.get('actions'):null;}
    setAttribute(key,value){this.attributes[key]=value;}
    getBoundingClientRect(){return this.bounds||{left:0,top:0,right:1000,bottom:800};}
    focus(){const old=doc.activeElement;if(old===this)return;doc.activeElement=this;old?.emit('focusout',{relatedTarget:this});this.emit('focusin',{relatedTarget:old});}
    emit(type,extra={}){
      const event={target:this,type,...extra},path=[];for(let node=this;node;node=node.parent)path.push(node);
      for(const node of path.toReversed())for(const {fn,capture} of [...node.listeners.get(type)||[]])if(capture)fn(event);
      for(const node of path)for(const {fn,capture} of [...node.listeners.get(type)||[]])if(!capture)fn(event);
      return event;
    }
  }
  const win=new Node('window'),doc=new Node('document');win.append(doc);doc.hidden=false;doc.fullscreenElement=null;doc.getElementById=id=>ids.get(id);doc.createComment=()=>new Node();
  const main=new Node('main');doc.append(main);
  const viewer=new Node('viewer'),canvas=new Node('canvas'),actions=new Node('actions'),button=new Node('fullscreen'),dock=new Node('fullscreen-controls'),transport=new Node('playback-controls'),playlist=new Node('playlist'),dialog=new Node('playlist-window'),settings=new Node('settings');
  main.append(viewer);viewer.append(canvas);viewer.append(actions);actions.append(button);viewer.append(dock);main.append(transport);main.append(settings);main.append(playlist);main.append(dialog);
  const play=new Node('play'),seek=new Node('seek');transport.append(play);transport.append(seek);
  dock.bounds={left:16,top:600,right:984,bottom:784};dialog.open=false;dialog.closeParents=[];
  dialog.close=()=>{if(!dialog.open)return;dialog.closeParents.push(dialog.parent);dialog.open=false;dialog.modal=false;dialog.emit('close');};
  dialog.showModal=()=>{if(dialog.open&&!dialog.modal)throw Error('Dialog already open nonmodally');dialog.open=true;dialog.modal=true;dialog.focus();};
  doc.activeElement=canvas;
  const mainOrder=[...main.children],viewerOrder=[...viewer.children];
  const controller=installDesktopFullscreenControls({document:doc,window:win,setTimeout:(fn,ms)=>{const id=++serial;timers.set(id,{fn,when:now+ms});return id;},clearTimeout:id=>timers.delete(id)});
  function tick(ms){const end=now+ms;for(;;){const next=[...timers].filter(([,t])=>t.when<=end).sort((a,b)=>a[1].when-b[1].when)[0];if(!next)break;now=next[1].when;timers.delete(next[0]);next[1].fn();}now=end;}
  const fullscreen=value=>{doc.fullscreenElement=value?viewer:null;doc.emit('fullscreenchange');};
  const move=(x,y,extra={})=>canvas.emit('pointermove',{clientX:x,clientY:y,pointerId:1,buttons:0,...extra});
  const pointer=(node,type,extra={})=>node.emit(type,{pointerId:1,pointerType:'mouse',buttons:type==='pointerdown'?1:0,...extra});
  return {win,doc,main,viewer,canvas,actions,button,dock,transport,playlist,dialog,play,seek,controller,timers,mainOrder,viewerOrder,tick,fullscreen,move,pointer,hidden:()=>viewer.classList.contains('fullscreen-controls-hidden')};
}

test('fullscreen uses the same live controls and restores exact nodes/order on repeated exit',()=>{
  const h=harness();let clicks=0,seeks=0;h.play.addEventListener('click',()=>clicks++);h.seek.addEventListener('input',()=>seeks++);
  assert.equal(h.timers.size,0);
  for(let i=0;i<3;i++){
    h.fullscreen(true);assert.deepEqual(h.dock.children,[h.actions,h.transport,h.playlist]);assert.equal(h.dialog.parent,h.viewer);assert.equal(h.button.textContent,'Exit full screen');
    h.play.emit('click');h.seek.emit('input');h.tick(2000);assert.ok(h.hidden());
    h.fullscreen(false);assert.deepEqual(h.main.children,h.mainOrder);assert.deepEqual(h.viewer.children,h.viewerOrder);assert.equal(h.timers.size,0);assert.ok(!h.hidden());assert.equal(h.button.textContent,'Full screen');
  }
  assert.equal(clicks,3);assert.equal(seeks,3);
});
test('idle hides at exactly two seconds; ordinary movement resets only while visible, proximity reveals while hidden',()=>{
  const h=harness();h.fullscreen(true);h.tick(1999);assert.ok(!h.hidden());h.tick(1);assert.ok(h.hidden());
  h.move(500,200);assert.ok(h.hidden());h.move(500,551);assert.ok(h.hidden());h.move(500,552);assert.ok(!h.hidden());
  h.tick(1500);h.move(500,100);h.tick(1999);assert.ok(!h.hidden());h.tick(1);assert.ok(h.hidden());
  h.move(-1,790);assert.ok(h.hidden(),'outside viewer is not proximity');h.move(1000,799);assert.ok(!h.hidden());
});
test('mouse-click focus does not pin controls forever and idle transfers focus to the canvas',()=>{
  const h=harness();h.fullscreen(true);h.pointer(h.play,'pointerdown');h.play.focus();h.pointer(h.play,'pointerup');h.play.emit('click');
  h.tick(2000);assert.ok(h.hidden());assert.equal(h.doc.activeElement,h.canvas);assert.equal(h.timers.size,0);
});
test('clicking a button child or a label still idles after the resulting control receives focus',()=>{
  const h=harness();h.fullscreen(true);
  // A label's default click action may focus its input after pointerup.
  h.pointer(h.transport,'pointerdown');h.pointer(h.transport,'pointerup');h.seek.focus();h.transport.emit('click');
  h.tick(2000);assert.ok(h.hidden());assert.equal(h.doc.activeElement,h.canvas);
  h.move(500,750);h.pointer(h.transport,'pointerdown');h.play.focus();h.pointer(h.transport,'pointerup');h.play.emit('click');h.tick(2000);assert.ok(h.hidden());
});
test('keyboard and assistive focus reveal hidden controls and stay visible until focus leaves',()=>{
  const h=harness();h.fullscreen(true);h.tick(2000);h.canvas.emit('keydown',{key:'Tab'});assert.ok(!h.hidden());h.play.focus();h.tick(10000);assert.ok(!h.hidden());assert.equal(h.timers.size,0);
  h.canvas.focus();h.tick(2000);assert.ok(h.hidden());h.seek.focus();assert.ok(!h.hidden(),'programmatic/assistive focus also reveals');h.tick(10000);assert.ok(!h.hidden());
  h.seek.emit('keydown',{key:'Escape'});assert.equal(h.doc.activeElement,h.seek,'Escape is not consumed');
});
test('keyboard fullscreen entry retains focused action; pointer entry gets idle timeout',()=>{
  const h=harness();h.button.focus();h.button.emit('keydown',{key:'Enter'});h.fullscreen(true);h.tick(10000);assert.ok(!h.hidden());assert.equal(h.doc.activeElement,h.button);
  h.fullscreen(false);h.pointer(h.button,'pointerdown');h.fullscreen(true);h.tick(2000);assert.ok(h.hidden());
});
test('held pointer scrub survives idle; release outside, cancellation and lost capture restart timer',()=>{
  for(const finish of ['pointerup','pointercancel','lostpointercapture']){
    const h=harness();h.fullscreen(true);h.pointer(h.seek,'pointerdown');h.seek.focus();h.tick(5000);assert.ok(!h.hidden());
    h.pointer(h.win,finish);h.tick(1999);assert.ok(!h.hidden());h.tick(1);assert.ok(h.hidden(),finish);
  }
});
test('released buttons recover a missed pointerup and multiple pointers cannot end another scrub',()=>{
  const h=harness();h.fullscreen(true);h.pointer(h.seek,'pointerdown');h.pointer(h.seek,'pointerdown',{pointerId:2});h.pointer(h.win,'pointerup');h.tick(5000);assert.ok(!h.hidden());
  h.move(500,300,{pointerId:2,buttons:0});h.tick(2000);assert.ok(h.hidden());
});
test('touch reveals by tapping the viewer, keeps a held control usable, and does not interfere with its events',()=>{
  const h=harness();h.fullscreen(true);h.tick(2000);h.pointer(h.canvas,'pointerdown',{pointerType:'touch'});assert.ok(!h.hidden());h.pointer(h.canvas,'pointerup',{pointerType:'touch'});
  const event=h.pointer(h.seek,'pointerdown',{pointerType:'touch'});assert.equal(event.defaultPrevented,undefined);h.tick(5000);assert.ok(!h.hidden());h.pointer(h.seek,'pointercancel',{pointerType:'touch'});h.tick(2000);assert.ok(h.hidden());
});
test('playlist modal pins controls, close restarts idle, and legacy hidden controls do not block proximity',()=>{
  const h=harness();h.fullscreen(true);h.dialog.open=true;h.tick(2000);assert.ok(!h.hidden());h.dialog.open=false;h.dialog.emit('close');h.tick(2000);assert.ok(h.hidden());
  h.viewer.classList.add('controls-hidden');h.move(500,750);assert.ok(!h.hidden());assert.ok(!h.viewer.classList.contains('controls-hidden'));
});
test('external fullscreen exit and disposal close an open modal before reparenting so it can reopen',()=>{
  for(const finish of ['fullscreen-exit','dispose','pagehide']){
    const h=harness();h.fullscreen(true);h.dialog.showModal();assert.equal(h.dialog.modal,true);
    if(finish==='fullscreen-exit')h.fullscreen(false);else if(finish==='dispose')h.controller.dispose();else h.win.emit('pagehide');
    assert.equal(h.dialog.closeParents.at(-1),h.viewer,'close occurs before the dialog leaves fullscreen');
    assert.equal(h.dialog.open,false);assert.equal(h.dialog.modal,false);assert.equal(h.dialog.parent,h.main);assert.equal(h.timers.size,0);
    if(finish==='fullscreen-exit')assert.equal(h.doc.activeElement,h.button,'focus must not be restored inside a closed dialog');
    // createPlaylistBrowser.open() returns early for an already-open dialog.
    if(!h.dialog.open)h.dialog.showModal();
    assert.equal(h.dialog.open,true);assert.equal(h.dialog.modal,true,'Browse playlist remains able to reopen a modal');
  }
});
test('fullscreen entry closes an existing modal before moving it, and ordinary disposal leaves it alone',()=>{
  const h=harness();h.dialog.showModal();h.fullscreen(true);
  assert.equal(h.dialog.closeParents.at(-1),h.main);assert.equal(h.dialog.open,false);assert.equal(h.dialog.parent,h.viewer);assert.equal(h.doc.activeElement,h.button);
  h.dialog.showModal();assert.equal(h.dialog.modal,true);h.fullscreen(false);
  h.dialog.showModal();const closes=h.dialog.closeParents.length;h.controller.dispose();
  assert.equal(h.dialog.closeParents.length,closes,'without moved nodes disposal must not close the normal-page playlist');assert.equal(h.dialog.modal,true);
});
test('blur and page hiding release held pointers and timers, resume gets a fresh two seconds',()=>{
  for(const visibility of [false,true]){
    const h=harness();h.fullscreen(true);h.pointer(h.seek,'pointerdown');
    if(visibility){h.doc.hidden=true;h.doc.emit('visibilitychange');}else h.win.emit('blur');
    assert.equal(h.timers.size,0);h.tick(10000);
    if(visibility){h.doc.hidden=false;h.doc.emit('visibilitychange');}else h.win.emit('focus');
    assert.ok(!h.hidden());h.tick(2000);assert.ok(h.hidden());
  }
});
test('desktop fullscreen remains usable through immersive/mirror events without sending transport or XR actions',()=>{
  const h=harness();let actions=0;
  for(const name of ['xrpanelaction','xrtoggleplay','xrseek'])h.canvas.addEventListener(name,()=>actions++);
  h.fullscreen(true);h.canvas.emit('xrmirrorchange',{detail:{enabled:true,active:true}});h.canvas.emit('vrstart');assert.equal(h.transport.parent,h.dock);
  h.tick(2000);assert.ok(h.hidden());h.move(500,750);assert.ok(!h.hidden());assert.equal(h.transport.parent,h.dock);
  h.canvas.emit('xrmirrorchange',{detail:{enabled:false,active:false}});h.canvas.emit('vrend');assert.equal(h.transport.parent,h.dock);assert.equal(actions,0);
  h.fullscreen(false);assert.equal(h.transport.parent,h.main);assert.equal(h.timers.size,0);
});
test('persisted pagehide suspends and pageshow reconciles fullscreen state without disposing controls',()=>{
  for(const stillFullscreen of [false,true]){
    const h=harness();h.fullscreen(true);h.pointer(h.seek,'pointerdown');h.win.emit('pagehide',{persisted:true});assert.equal(h.timers.size,0);h.tick(10000);
    if(!stillFullscreen)h.doc.fullscreenElement=null;
    h.win.emit('pageshow',{persisted:true});assert.equal(h.transport.parent,stillFullscreen?h.dock:h.main);
    if(!stillFullscreen)h.fullscreen(true);
    h.tick(2000);assert.ok(h.hidden());h.move(500,750);assert.ok(!h.hidden());
  }
});
test('unrelated fullscreen, failed entry, repeated changes and disposal never orphan nodes or timers',()=>{
  const h=harness();h.doc.fullscreenElement=h.canvas;h.doc.emit('fullscreenchange');assert.equal(h.timers.size,0);assert.equal(h.transport.parent,h.main);
  h.fullscreen(true);h.doc.emit('fullscreenchange');assert.equal(h.dock.children.length,3);h.win.emit('pagehide');h.controller.dispose();assert.equal(h.timers.size,0);assert.deepEqual(h.main.children,h.mainOrder);assert.deepEqual(h.viewer.children,h.viewerOrder);
  h.fullscreen(true);h.move(500,750);h.controller.reveal();assert.equal(h.timers.size,0);assert.equal(h.transport.parent,h.main);
});
test('HTML, CSS and app wiring keep one accessible transport and hidden dock reachable by keyboard',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8'),css=readFileSync(new URL('../src/style.css',import.meta.url),'utf8'),app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
  for(const id of ['play','seek','previous','next','muted','volume','fullscreen-controls','playback-controls'])assert.equal(html.match(new RegExp(`id="${id}"`,'g')).length,1);
  assert.match(html,/id="seek" aria-label="Seek video"/);assert.match(css,/#viewer\.fullscreen-controls-hidden #fullscreen-controls\{[^}]*visibility:hidden;pointer-events:none/);
  assert.match(css,/#fullscreen-controls \.viewer-bottom\{position:static/);assert.match(css,/safe-area-inset-bottom/);assert.match(app,/fullscreenControls\.hide\(\)/);assert.match(app,/revealControls:.*fullscreenControls\.reveal/);
});
