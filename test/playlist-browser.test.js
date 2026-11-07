import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
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
  focus(options){document.activeElement=this;this.focusOptions=options;}
  scrollIntoView(options){this.scrollOptions=options;this.scrollCalls=(this.scrollCalls||0)+1;}
  getContext(){this.draws??=[];this.labels??=[];return {fillRect(){},fillText:(...args)=>this.labels.push(args),drawImage:(...args)=>this.draws.push(args)};}
  showModal(){this.open=true;}
  close(){this.open=false;}
  getBoundingClientRect(){return this.bounds||{left:10,right:100,top:10,bottom:100};}
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
 h.el('playlist-layout').click();assert.equal(h.el('playlist-items').className,'playlist-grid');assert.equal(h.el('playlist-items').children.length,3);
 h.el('playlist-sort').handlers.change({target:{value:'size'}});h.el('playlist-direction').click();assert.equal(h.state.items[0].added,15);
 assert.ok(h.el('playlist-items').children.some(node=>node.attrs['aria-current']==='true'));
 h.el('playlist-items').children[0].click();assert.deepEqual(h.selected,['1:2']);assert.equal(h.el('playlist-window').open,false);
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
test('gallery shows only filename, size and a plain stored date on separate lines in both layouts',()=>{
 const h=harness(1),item=h.state.items[0];Object.assign(item,{size:1048576,cameraModel:'<Camera>',cameraFirmware:'TEST.01',duration:95,videoTracks:[{width:4096,height:1344,codec:'hvc1'},{width:4096,height:1344,codec:'hvc1'}],dateTaken:Date.UTC(2024,0,1,12),dateTakenSource:'Embedded movie creation time (timezone unverified)',thumbnailDone:true,thumbnailSource:'Generated native keyframe near midpoint (unstitched)'});
 h.browser.open();
 const read=()=>h.el('playlist-items').children[0].children[1].children.map(node=>node.textContent);
 const expected=['1. <img src=x onerror=alert(1)>','1.0 MiB','2024-01-01 12:00:00'];
 assert.deepEqual(read(),expected);
 h.state.generateThumbnails=true;h.state.version++;h.browser.render();assert.deepEqual(read(),expected);
 h.el('playlist-layout').click();assert.deepEqual(read(),expected);
 item.dateTaken=null;h.state.version++;h.browser.render();assert.deepEqual(read(),[expected[0],expected[1],'Date unavailable']);
 delete globalThis.document;
});

test('larger browser previews widen the actual drawing area, preserve aspect and leave grid unchanged',()=>{
 const h=harness(1);h.state.items[0].thumbnail={width:320,height:105};h.browser.open();
 const canvas=()=>h.el('playlist-items').children[0].children[0];
 const normal=canvas();assert.equal(normal.width,320);assert.equal(normal.height,180);
 h.state.doubleHeightRows=true;h.browser.render();const large=canvas();
 assert.equal(large.width,640);assert.equal(large.height,280);
 const [,x,y,w,height]=large.draws[0];assert.equal(w,640);assert.equal(height,210);assert.equal(w/height,320/105);assert.equal(x,0);assert.equal(y,35);
 assert.equal(large.attrs['aria-hidden'],'true');
 h.el('playlist-layout').click();assert.equal(canvas().width,normal.width);assert.equal(canvas().height,normal.height);assert.deepEqual(canvas().draws,normal.draws);
 h.el('playlist-layout').click();h.state.items[0].thumbnail=null;h.state.version++;h.browser.render();assert.deepEqual(canvas().labels[0].slice(1),[320,145]);
 delete globalThis.document;
});

test('wide browser previews fit their row, wrap on small screens, and keep the existing dialog size',()=>{
 const css=readFileSync(new URL('../src/style.css',import.meta.url),'utf8');
 assert.match(css,/#playlist-window\{[^}]*width:min\(1100px,94vw\)/);
 assert.match(css,/\.playlist-list\.playlist-large-rows \.playlist-item\{[^}]*min-height:288px;flex-wrap:wrap/);
 assert.match(css,/\.playlist-list\.playlist-large-rows \.playlist-item canvas\{width:576px;max-width:100%;height:auto;aspect-ratio:16\/7/);
 assert.match(css,/width:min\(384px,100%\);align-self:center/);
 assert.match(css,/\.playlist-grid \.playlist-item canvas\{width:100%;height:auto;aspect-ratio:16\/9/);
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');assert.match(html,/<option value="dateTaken">Date<\/option>/);assert.match(html,/timezone unverified/);
});

test('double-height list rows repaginate, retain focus and leave grid layout unchanged',()=>{
 const h=harness(30);h.browser.open();h.el('playlist-page-next').click();
 assert.equal(h.el('playlist-items').children[0].dataset.clipId,'1:12');h.el('playlist-items').children[1].focus();
 h.state.doubleHeightRows=true;h.browser.render();
 assert.equal(h.el('playlist-items').className,'playlist-list playlist-large-rows');assert.equal(h.el('playlist-items').children.length,6);
 assert.equal(h.el('playlist-items').children[0].dataset.clipId,'1:12');assert.equal(h.document.activeElement.dataset.clipId,'1:13');assert.equal(h.el('playlist-page').textContent,'30 videos · Page 3 / 5');
 h.state.doubleHeightRows=false;h.browser.render();assert.equal(h.el('playlist-items').children.length,12);assert.equal(h.el('playlist-items').children[0].dataset.clipId,'1:12');
 h.state.doubleHeightRows=true;h.el('playlist-layout').click();assert.equal(h.el('playlist-items').className,'playlist-grid');assert.equal(h.el('playlist-items').children.length,12);
 h.el('playlist-layout').click();assert.equal(h.el('playlist-items').children.length,6);
 h.browser.close();h.browser.open();assert.equal(h.el('playlist-items').className,'playlist-list playlist-large-rows');
 h.el('playlist-page-next').click();h.el('playlist-items').children[0].click();assert.deepEqual(h.selected,['1:6']);
 delete globalThis.document;
});

test('desktop opens and reopens on current video in either layout and row density',()=>{
 const h=harness(40),visible=()=>h.el('playlist-items').children;
 for(const large of [false,true])for(const grid of [false,true]){
  h.browser.close();h.state.doubleHeightRows=large;h.state.selectedId='1:29';h.browser.open();
  if((h.el('playlist-items').className==='playlist-grid')!==grid)h.el('playlist-layout').click();
  // Opening recomputes from playback using the saved layout, not a stale page.
  h.browser.close();h.browser.open();assert.ok(visible().some(n=>n.dataset.clipId==='1:29'&&n.attrs['aria-current']==='true'));
  h.el('playlist-page-back').click();h.browser.open();assert.ok(!visible().some(n=>n.dataset.clipId==='1:29'),'already open must not steal manual browsing');
  h.browser.close();h.state.selectedId='1:38';h.browser.open();assert.ok(visible().some(n=>n.dataset.clipId==='1:38'));
 }
 delete globalThis.document;
});
test('desktop layout and density round trips retain the original anchor instead of walking backwards',()=>{
 const h=harness(40),ids=()=>h.el('playlist-items').children.map(n=>n.dataset.clipId);
 h.state.doubleHeightRows=true;h.state.selectedId='1:20';h.browser.open();assert.equal(ids()[0],'1:18');
 for(let n=0;n<3;n++){
  h.el('playlist-layout').click();assert.ok(ids().includes('1:18'));assert.equal(ids()[0],'1:12');
  h.el('playlist-layout').click();assert.equal(ids()[0],'1:18');
  h.state.doubleHeightRows=false;h.browser.render();assert.ok(ids().includes('1:18'));
  h.state.doubleHeightRows=true;h.browser.render();assert.equal(ids()[0],'1:18');
 }
 h.el('playlist-page-next').click();assert.equal(ids()[0],'1:24');
 h.state.version++;h.browser.render();assert.equal(ids()[0],'1:24','thumbnail repaint must not jump to playing item');
 delete globalThis.document;
});
test('desktop follows stable current ID through explicit sorting, playback changes and replacement queues',()=>{
 const h=harness(31),ids=()=>h.el('playlist-items').children.map(n=>n.dataset.clipId);
 h.state.items.forEach(item=>item.name='duplicate.mp4');h.state.selectedId='1:22';h.browser.open();
 h.el('playlist-sort').handlers.change({target:{value:'size'}});h.el('playlist-direction').click();assert.ok(ids().includes('1:22'));
 h.state.selectedId='1:0';h.browser.render();assert.ok(ids().includes('1:0'));
 h.state.items=createPlaylistEntries(Array.from({length:15},()=>({name:'duplicate.mp4',size:1})),2);h.state.selectedId='2:14';h.state.version++;h.browser.render();assert.ok(ids().includes('2:14'));
 h.state.items=[];h.state.selectedId=undefined;h.state.version++;h.browser.render();assert.equal(ids().length,0);assert.equal(h.el('playlist-page').textContent,'0 videos · Page 1 / 1');
 h.browser.close();h.browser.open();assert.equal(ids().length,0);
 delete globalThis.document;
});

test('desktop scrolls current clip into view on every reopen, and page navigation reveals its first row',()=>{
 const h=harness(31),rows=()=>h.el('playlist-items').children;
 h.state.selectedId='1:22';h.browser.open();let selected=rows().find(n=>n.dataset.clipId==='1:22');assert.deepEqual(selected.scrollOptions,{block:'nearest'});
 h.el('playlist-window').scrollTop=800;h.browser.close();h.browser.open();assert.equal(selected.scrollCalls,2,'reopening an unchanged page still reveals current video');
 h.el('playlist-page-next').click();assert.equal(rows()[0].dataset.clipId,'1:24');assert.deepEqual(rows()[0].scrollOptions,{block:'nearest'});
 h.el('playlist-page-back').click();assert.equal(rows()[0].dataset.clipId,'1:12');assert.deepEqual(rows()[0].scrollOptions,{block:'nearest'});
 h.state.selectedId='1:23';h.browser.render();selected=rows().find(n=>n.dataset.clipId==='1:23');assert.deepEqual(selected.scrollOptions,{block:'nearest'});
 selected.focus();h.el('playlist-window').scrollTop=777;h.state.version++;h.browser.render();
 assert.equal(h.el('playlist-window').scrollTop,777);assert.deepEqual(h.document.activeElement.focusOptions,{preventScroll:true});assert.equal(h.document.activeElement.scrollCalls,undefined,'metadata alone must not scroll');
 delete globalThis.document;
});
test('manual desktop scroll anchors the first viewport-visible clip on density/layout changes',()=>{
 const h=harness(40),rows=()=>h.el('playlist-items').children;
 h.state.selectedId='1:12';h.browser.open();h.el('playlist-window').bounds={top:0,bottom:400};
 rows().forEach((node,index)=>node.bounds={top:(index-8)*150,bottom:(index-7)*150});
 h.state.doubleHeightRows=true;h.browser.render();assert.equal(rows()[0].dataset.clipId,'1:18');
 assert.deepEqual(rows().find(n=>n.dataset.clipId==='1:20').scrollOptions,{block:'nearest'});
 for(let n=0;n<3;n++){
  h.el('playlist-layout').click();assert.deepEqual(rows().find(n=>n.dataset.clipId==='1:20').scrollOptions,{block:'nearest'});
  h.el('playlist-layout').click();assert.equal(rows()[0].dataset.clipId,'1:18');assert.deepEqual(rows().find(n=>n.dataset.clipId==='1:20').scrollOptions,{block:'nearest'});
 }
 delete globalThis.document;
});
