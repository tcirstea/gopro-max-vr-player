import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspectFile,formatTime} from '../src/inspect.js';
const box=(type,...payload)=>{const data=Buffer.concat(payload);const head=Buffer.alloc(8);head.writeUInt32BE(data.length+8);head.write(type,4);return Buffer.concat([head,data]);};
function track(codec='hvc1',type='vide'){
 const h=Buffer.alloc(12);h.write(type,8);const sample=Buffer.alloc(28);sample.writeUInt16BE(4096,24);sample.writeUInt16BE(1344,26);
 return box('trak',box('mdia',box('hdlr',h),box('minf',box('stbl',box('stsd',Buffer.from([0,0,0,0,0,0,0,1]),box(codec,sample))))));
}
const file=(data,name='clip.mp4')=>new File([data],name);
test('reads track codecs and dimensions',async()=>{const r=await inspectFile(file(box('moov',track())));assert.equal(r.videoTracks[0].codec,'hvc1');assert.equal(r.videoTracks[0].width,4096);assert.equal(r.videoTracks[0].height,1344);assert.equal(r.nativeCandidate,false);});
test('flags .360 files without assuming equirectangular projection',async()=>assert.equal((await inspectFile(file(box('moov',track()),'GS010001.360'))).nativeCandidate,true));
test('flags multiple video tracks even when renamed .mp4',async()=>assert.equal((await inspectFile(file(box('moov',track(),track())))).nativeCandidate,true));
test('reads ftyp and skips mdat',async()=>{const r=await inspectFile(file(Buffer.concat([box('ftyp',Buffer.from('mp42')),box('mdat',Buffer.alloc(1000)),box('moov',track('avc1'))])));assert.equal(r.brand,'mp42');assert.equal(r.videoTracks[0].codec,'avc1');});
test('rejects truncation and invalid box sizes',async()=>{await assert.rejects(()=>inspectFile(file(Buffer.from([0,0,0,2,109,111,111,118]))),/Invalid/);await assert.rejects(()=>inspectFile(file(Buffer.from([0,0,0,99,109,111,111,118]))),/Truncated/);await assert.rejects(()=>inspectFile(file(Buffer.from([0,0,0]))),/Truncated/);});
test('rejects absent movie metadata',async()=>await assert.rejects(()=>inspectFile(file(box('mdat',Buffer.alloc(1)))),/No MP4/));
test('supports extended size and zero-size final boxes',async()=>{const payload=track();const h=Buffer.alloc(16);h.writeUInt32BE(1);h.write('moov',4);h.writeBigUInt64BE(BigInt(payload.length+16),8);assert.equal((await inspectFile(file(Buffer.concat([h,payload])))).videoTracks.length,1);const zero=box('moov',track());zero.writeUInt32BE(0);assert.equal((await inspectFile(file(zero))).videoTracks.length,1);});
test('does not read video payloads',async()=>{const data=Buffer.concat([box('mdat',Buffer.alloc(1024*1024)),box('moov',track())]);const reads=[];const input={size:data.length,name:'large.mp4',slice(start,end){reads.push(end-start);return new Blob([data.subarray(start,end)]);}};await inspectFile(input);assert.ok(reads.reduce((a,b)=>a+b,0)<1024);});
test('formats finite time safely',()=>{assert.equal(formatTime(NaN),'0:00');assert.equal(formatTime(-1),'0:00');assert.equal(formatTime(125),'2:05');});
test('rejects oversized movie metadata without reading it',async()=>{const h=Buffer.alloc(8);h.writeUInt32BE(17*1024*1024);h.write('moov',4);let reads=0;const input={size:17*1024*1024,name:'large.360',slice(){reads++;return new Blob([h]);}};await assert.rejects(()=>inspectFile(input),/16 MiB/);assert.equal(reads,1);});
test('rejects malformed nested sample entry',async()=>{const data=box('moov',track());data.writeUInt32BE(999999,data.length-36);await assert.rejects(()=>inspectFile(file(data)),/exceeds/);});
