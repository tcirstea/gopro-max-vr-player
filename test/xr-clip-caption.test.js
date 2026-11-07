import {test} from 'node:test';
import assert from 'node:assert/strict';
import {xrClipCaption,fitCaptionText,paintClipCaption,clipCaptionCenter,CAPTION_WIDTH,CAPTION_HEIGHT,CAPTION_WORLD_HEIGHT,CAPTION_GAP} from '../src/xr-clip-caption.js';

test('current clip caption uses stable selection and stored file clock, never filesystem last-modified',()=>{
 const items=[{id:'a',name:'a.360',dateTaken:Date.UTC(2024,3,15,12,30,45),metadataDone:true},{id:'b',name:'b.mp4',dateTaken:null,lastModified:Date.now(),metadataDone:false}];
 const playlist={items,selectedId:'a'};
 const caption=xrClipCaption(playlist);
 assert.deepEqual(caption,{id:'a',name:'a.360',date:'File date: 2024-04-15 12:30:45 · timezone unverified'});
 items.reverse();assert.deepEqual(xrClipCaption(playlist),caption);
 playlist.selectedId='b';assert.equal(xrClipCaption(playlist).date,'Reading file date…');
 items[0].metadataDone=true;assert.equal(xrClipCaption(playlist).date,'Date unavailable');
 for(const dateTaken of [null,undefined,NaN,Infinity,1e99]){items[0].dateTaken=dateTaken;assert.equal(xrClipCaption(playlist).date,'Date unavailable');}
 for(const playlist of [undefined,{}, {items}, {items,selectedId:'removed'}])assert.equal(xrClipCaption(playlist),null);
});

test('caption strips directory/control text, bounds pathological names, and measures Unicode without splitting surrogates',()=>{
 const caption=name=>xrClipCaption({items:[{id:1,name}],selectedId:1});
 assert.equal(caption('/private/folder/a\n\u202eb.360').name,'a b.360');
 assert.equal(caption('C:\\private\\folder\\clip.mp4').name,'clip.mp4');
 assert.equal(caption(' \t ').name,'Untitled');
 assert.ok(caption('x'.repeat(10000)).name.length<=1025);
 assert.equal(caption('a'+'🌄'.repeat(2000)).name,'a'+'🌄'.repeat(1023)+'…');
 const ctx={measureText:text=>({width:Array.from(text).reduce((sum,char)=>sum+(char==='W'?30:char==='i'?3:10),0)})};
 assert.equal(fitCaptionText(ctx,'iiiiiiii',30),'iiiiiiii');
 assert.equal(fitCaptionText(ctx,'WWWWWW',75),'WW…');
 assert.equal(fitCaptionText(ctx,'🌄'.repeat(20),55),'🌄🌄🌄🌄…');
});

test('caption paints only bounded outlined text over transparency, with no panel background',()=>{
 const calls=[];
 const ctx=new Proxy({measureText:text=>({width:Array.from(text).length*20})},{get:(target,key)=>key in target?target[key]:(...args)=>calls.push([key,...args])});
 paintClipCaption(ctx,{name:'W'.repeat(200),date:'Date unavailable'});
 assert.deepEqual(calls[0],['clearRect',0,0,CAPTION_WIDTH,CAPTION_HEIGHT]);
 assert.ok(calls.some(call=>call[0]==='clip'));assert.ok(!calls.some(call=>call[0]==='fillRect'));
 const texts=calls.filter(call=>call[0]==='fillText');assert.equal(texts.length,2);assert.ok(texts[0][1].endsWith('…'));
 for(const [,text,x,y] of texts){assert.ok(x+ctx.measureText(text).width<=CAPTION_WIDTH-40);assert.ok(y>0&&y<CAPTION_HEIGHT);}
 calls.length=0;paintClipCaption(ctx,null);assert.deepEqual(calls,[['clearRect',0,0,CAPTION_WIDTH,CAPTION_HEIGHT]]);
});

test('caption follows panel local up above either height without changing panel geometry',()=>{
 const panel={center:[1,2,3],up:[1,0,0]},before=structuredClone(panel);
 for(const height of [.375,.9]){
  const center=clipCaptionCenter(panel,height);
  assert.ok(Math.abs(center[0]-1-CAPTION_WORLD_HEIGHT/2-height/2-CAPTION_GAP)<1e-12);assert.equal(center[1],2);assert.equal(center[2],3);
 }
 assert.deepEqual(panel,before);
});
