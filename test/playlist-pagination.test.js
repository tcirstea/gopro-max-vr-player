import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPlaylistPagination, playlistPage} from '../src/playlist-pagination.js';

const state = (length=40, selected=0) => ({items:Array.from({length},(_,id)=>({id,name:'duplicate.mp4',added:id+1})),selectedId:selected,sort:'added',descending:false});
test('opening always finds the actual selected ID in sorted order and any density',()=>{
 for(const count of [2,5,6,12])for(const selected of [0,1,4,5,9,10,11,12,23,39]){
  const p=createPlaylistPagination(),s=state(40,selected);
  assert.equal(p.open(s,count).page,Math.floor(selected/count));
  p.move(-999,s,count);assert.equal(p.open(s,count).page,Math.floor(selected/count));
  s.items.reverse();assert.equal(p.open(s,count).page,Math.floor((39-selected)/count));
 }
});
test('first page item stays visible across repeated list/grid/density round trips without drift',()=>{
 for(const [from,to] of [[5,6],[6,5],[2,6],[6,2],[12,6],[6,12]]){
  const p=createPlaylistPagination(),s=state(40,17);p.open(s,from);
  const before=p.move(1,s,from),anchor=s.items[before.start].id;
  for(let n=0;n<4;n++)for(const count of [to,from]){
   const result=p.sync(s,count);assert.ok(s.items.slice(result.start,result.start+count).some(item=>item.id===anchor));
  }
  assert.equal(p.sync(s,from).page,before.page);
 }
});
test('manual paging wins over unchanged selection and metadata, while selection and explicit sorts follow playback',()=>{
 const p=createPlaylistPagination(),s=state(40,14);p.open(s,5);p.move(2,s,5);
 s.version=55;assert.equal(p.sync(s,5).page,4);
 s.items=[...s.items.slice(10),...s.items.slice(0,10)];
 assert.equal(p.sync(s,5).page,2,'stable anchor follows a metadata reorder');
 s.selectedId=33;assert.equal(p.sync(s,5).page,4);
 s.sort='name';s.items.reverse();assert.equal(p.sync(s,5).page,3);
 s.descending=true;s.items.reverse();assert.equal(p.sync(s,5).page,4);
});
test('empty, stale selection, removed anchors, queue replacement and boundary pages stay valid',()=>{
 const p=createPlaylistPagination(),s=state(13,12);assert.equal(p.open(s,5).page,2);
 assert.equal(p.move(999,s,5).page,2);assert.equal(p.move(-999,s,5).page,0);
 s.selectedId='stale';assert.equal(p.open(s,5).page,0);
 p.move(2,s,5);s.items=s.items.slice(0,3);assert.equal(p.sync(s,5).page,0);
 s.items=[];assert.deepEqual(p.sync(s,5),{page:0,pages:1,count:5,start:0});
 s.items=Array.from({length:14},(_,id)=>({id:`new:${id}`}));s.selectedId='new:13';assert.equal(p.sync(s,5).page,2);
 s.items=s.items.slice(0,12);assert.equal(p.sync(s,5).page,2);
 s.items=s.items.filter(item=>item.id!=='new:10');assert.equal(p.sync(s,5).page,2);
 for(const request of [NaN,Infinity,-Infinity,-10])assert.equal(playlistPage(13,5,request).page,0);
 assert.equal(playlistPage(13,5,1.9).page,1);assert.equal(playlistPage(13,5,999).page,2);
 assert.deepEqual(playlistPage(0,0),{page:0,pages:1,count:1,start:0});
});
