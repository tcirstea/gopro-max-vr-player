import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPlaylistBrowser} from '../src/playlist-browser.js';
import {createPlaylistEntries,sortPlaylistEntries} from '../src/playlist-model.js';
function harness(count=15){
 const nodes=new Map(),selected=[];let document;
 class Element{
  constructor(){this.children=[];this.dataset={};this.handlers={};this.attrs={};this.open=false;}
  addEventListener(k,fn){this.handlers[k]=fn;}
  setAttribute(k,v){this.attrs[k]=v;}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=nodes;}
  focus(){document.activeElement=this;}
  getContext(){return {fillRect(){},fillText(){},drawImage(){}};}
  showModal(){this.open=true;}
  close(){this.open=false;}
  getBoundingClientRect(){return {left:10,right:100,top:10,bottom:100};}
  click(){this.handlers.click?.({target:this});}
 }
 const el=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
 document={getElementById:el,createElement:()=>new Element(),activeElement:new Element()};
 globalThis.document=document;
 let state={items:createPlaylistEntries(Array.from({length:count},(_,i)=>({name:i===0?'<img src=x onerror=alert(1)>':`clip${i}.mp4`,size:i*1024})),1),version:1,sort:'added',descending:false,selectedId:'1:0'};
 let browser;
 const sort=key=>{state.sort=key;state.items=sortPlaylistEntries(state.items,key,state.descending);state.version++;browser.render();};
 browser=createPlaylistBrowser({getState:()=>state,onSort:sort,onDirection(){state.descending=!state.descending;sort(state.sort);},onSelect:id=>selected.push(id)});
 return {el,browser,state,selected,document};
}
test('desktop playlist pages, toggles grid, sorts real state and keeps filenames as text',()=>{
 const h=harness();h.browser.open();assert.equal(h.el('playlist-items').children.length,12);
 const first=h.el('playlist-items').children[0];assert.equal(first.children[1].children[0].textContent,'1. <img src=x onerror=alert(1)>');assert.equal(first.attrs['aria-current'],'true');
 h.el('playlist-page-next').click();assert.equal(h.el('playlist-items').children.length,3);
 h.el('playlist-layout').click();assert.equal(h.el('playlist-items').className,'playlist-grid');assert.equal(h.el('playlist-items').children.length,12);
 h.el('playlist-sort').handlers.change({target:{value:'size'}});h.el('playlist-direction').click();assert.equal(h.state.items[0].added,15);
 h.el('playlist-items').children[0].click();assert.deepEqual(h.selected,['1:14']);assert.equal(h.el('playlist-window').open,false);
 delete globalThis.document;
});
test('close and reopen, thumbnail repaint focus, shrinking queue and backdrop dismissal are safe',()=>{
 const h=harness();h.browser.open();const selected=h.el('playlist-items').children[1];selected.focus();
 h.state.version++;h.browser.render();assert.equal(h.document.activeElement.dataset.clipId,'1:1');
 h.el('playlist-page-next').click();h.state.items=createPlaylistEntries([{name:'new.mp4',size:1}],2);h.state.version++;h.browser.render();assert.equal(h.el('playlist-page').textContent,'1 videos · Page 1 / 1');assert.equal(h.el('playlist-items').children.length,1);
 h.el('playlist-close').click();h.browser.open();assert.equal(h.el('playlist-window').open,true);
 h.el('playlist-window').handlers.click({target:h.el('playlist-window'),clientX:0,clientY:0});assert.equal(h.el('playlist-window').open,false);
 delete globalThis.document;
});
test('gallery labels local metadata, timezone uncertainty and experimental preview state without HTML',()=>{
 const h=harness(1),item=h.state.items[0];Object.assign(item,{cameraModel:'<Camera>',cameraFirmware:'TEST.01',duration:95,videoTracks:[{width:4096,height:1344,codec:'hvc1'},{width:4096,height:1344,codec:'hvc1'}],dateTaken:Date.UTC(2024,0,1,12),dateTakenSource:'Embedded movie creation time (timezone unverified)',thumbnailDone:true});
 h.browser.open();let details=h.el('playlist-items').children[0].children[1].children;
 assert.match(details[1].textContent,/2024-01-01 12:00:00 \(timezone unverified\)/);assert.match(details[2].textContent,/Preview generation is off/);assert.match(details[3].textContent,/<Camera> · Firmware TEST.01 · 1:35 · 4096 × 1344 per track · 2 video tracks · hvc1/);
 h.state.generateThumbnails=true;h.state.version++;h.browser.render();details=h.el('playlist-items').children[0].children[1].children;assert.match(details[2].textContent,/Preview unavailable/);
 item.thumbnailDone=false;h.state.version++;h.browser.render();details=h.el('playlist-items').children[0].children[1].children;assert.match(details[2].textContent,/Reading local file info/);
 item.thumbnailDone=true;item.thumbnailSource='Generated native keyframe near midpoint (unstitched)';h.state.version++;h.browser.render();details=h.el('playlist-items').children[0].children[1].children;assert.match(details[2].textContent,/unstitched/);delete globalThis.document;
});
