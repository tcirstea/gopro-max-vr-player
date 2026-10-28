import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSampleReader,READ_AHEAD_BYTES} from '../src/native-demux.js';

function source(size=128){
 const bytes=Uint8Array.from({length:size},(_,i)=>i%251),reads=[];
 return {bytes,reads,size,slice(start,end){reads.push([start,end]);return new Blob([bytes.slice(start,end)]);}};
}
test('read-ahead amortizes per-frame file reads and returns exact sample bytes',async()=>{
 const file=source(),reader=createSampleReader(file,32);
 for(let offset=0;offset<64;offset+=4)assert.deepEqual(await reader.read({offset,size:4}),file.bytes.slice(offset,offset+4));
 assert.deepEqual(file.reads,[[0,32],[32,64]]);
 const stats=reader.getDiagnostics();assert.equal(stats.readOperations,2);assert.equal(stats.cacheHits,14);assert.equal(stats.cachedBytes,32);assert.equal(stats.bytesRead,64);
 assert.ok(stats.readMilliseconds>=0);assert.ok(stats.maxReadMilliseconds>=0);
});
test('independent track windows tolerate interleaving, boundaries and backwards seeks',async()=>{
 const file=source(),readers=[createSampleReader(file,16),createSampleReader(file,16)];
 for(const [track,offset,size] of [[0,8,4],[1,80,4],[0,12,4],[1,84,4],[0,22,4],[0,0,4]])assert.deepEqual(await readers[track].read({offset,size}),file.bytes.slice(offset,offset+size));
 assert.deepEqual(file.reads,[[8,24],[80,96],[22,38],[0,16]]);
 assert.equal(readers[0].getDiagnostics().cachedBytes+readers[1].getDiagnostics().cachedBytes,32);
});
test('large samples get exact uncached reads and windows clamp to end of file',async()=>{
 const file=source(40),reader=createSampleReader(file,8);
 assert.deepEqual(await reader.read({offset:0,size:12}),file.bytes.slice(0,12));
 assert.equal(reader.getDiagnostics().cachedBytes,0);
 assert.deepEqual(await reader.read({offset:37,size:3}),file.bytes.slice(37));
 assert.deepEqual(file.reads,[[0,12],[37,40]]);assert.equal(reader.getDiagnostics().cachedBytes,3);
 assert.equal(READ_AHEAD_BYTES,4*1024*1024);
});
test('invalid and truncated reads fail without accepting partial sample data',async()=>{
 const file=source(),reader=createSampleReader(file,8);
 for(const sample of [{offset:-1,size:2},{offset:127,size:2},{offset:0,size:0},{offset:NaN,size:1},{offset:0,size:33*1024*1024}])await assert.rejects(reader.read(sample),/outside.*safety/);
 assert.equal(file.reads.length,0);
 const truncated=createSampleReader({size:32,slice(){return new Blob([new Uint8Array(2)]);}},8);
 await assert.rejects(truncated.read({offset:0,size:4}),/Truncated/);
 assert.equal(truncated.getDiagnostics().cachedBytes,0);
});
test('overlapping seek reads return their own bytes; stale reads do not replace current cache',async()=>{
 const file=source(),pending=[];
 const reader=createSampleReader({...file,slice(start,end){return {arrayBuffer:()=>new Promise(resolve=>pending.push(()=>resolve(file.bytes.slice(start,end).buffer)))};}},8);
 const old=reader.read({offset:0,size:4}),current=reader.read({offset:64,size:4});
 pending[1]();assert.deepEqual(await current,file.bytes.slice(64,68));
 pending[0]();assert.deepEqual(await old,file.bytes.slice(0,4));
 assert.deepEqual(await reader.read({offset:68,size:4}),file.bytes.slice(68,72));
 assert.equal(reader.getDiagnostics().cacheHits,1);assert.equal(reader.getDiagnostics().readOperations,2);
});
test('clearing while a read is in flight prevents cache retention after player close',async()=>{
 const file=source();let finish;
 const reader=createSampleReader({...file,slice(start,end){return {arrayBuffer:()=>new Promise(resolve=>finish=()=>resolve(file.bytes.slice(start,end).buffer))};}},8);
 const read=reader.read({offset:0,size:4});reader.clear();finish();
 assert.deepEqual(await read,file.bytes.slice(0,4));assert.equal(reader.getDiagnostics().cachedBytes,0);
});
