import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPlaylistEntries,sortPlaylistEntries,playlistDate,playlistSize} from '../src/playlist-model.js';
test('playlist entries keep immutable added order, unique IDs per queue and no fabricated creation time',()=>{
 const files=[{name:'a',size:20,lastModified:123},{name:'a',size:20}];
 const a=createPlaylistEntries(files,1),b=createPlaylistEntries(files,2);
 assert.notEqual(a[0].id,a[1].id);assert.notEqual(a[0].id,b[0].id);assert.equal(a[0].file,files[0]);assert.equal(a[0].fileCreated,null);
 assert.deepEqual(sortPlaylistEntries(a,'size',true).map(x=>x.added),[1,2]);assert.equal(playlistDate(null),'Unavailable');assert.equal(playlistSize(1048576),'1.0 MiB');
});
test('natural filename sorting and unknown numeric metadata preserve deterministic stable ties',()=>{
 const a=createPlaylistEntries([{name:'c10',size:1},{name:'c2',size:NaN},{name:'c1',size:1}],1);
 assert.deepEqual(sortPlaylistEntries(a,'name').map(x=>x.name),['c1','c2','c10']);
 assert.deepEqual(sortPlaylistEntries(a,'size',true).map(x=>x.name),['c10','c1','c2']);
 assert.deepEqual(sortPlaylistEntries(a,'unsupported'),a);assert.deepEqual(a.map(x=>x.added),[1,2,3]);
});
test('embedded clock display does not invent UTC or apply a browser timezone shift',()=>{
 const old=process.env.TZ;
 try{process.env.TZ='America/Los_Angeles';assert.equal(playlistDate(Date.UTC(2024,3,15,12)), '2024-04-15 12:00:00 (timezone unverified)');}
 finally{if(old===undefined)delete process.env.TZ;else process.env.TZ=old;}
});
