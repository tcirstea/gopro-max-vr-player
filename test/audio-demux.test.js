import {test} from 'node:test';
import assert from 'node:assert/strict';
import {demuxAudioTracks} from '../src/audio-demux.js';
const words=(...n)=>{const b=Buffer.alloc(4*n.length);n.forEach((x,i)=>b.writeUInt32BE(x,i*4));return b;};
const box=(type,...data)=>{const p=Buffer.concat(data),h=Buffer.alloc(8);h.writeUInt32BE(p.length+8);h.write(type,4);return Buffer.concat([h,p]);};
const descriptor=(tag,bytes,padded=false)=>Buffer.concat([Buffer.from(padded?[tag,0x80,0x80,bytes.length]:[tag,bytes.length]),bytes]);
const sa3d=({map=[0,1,2,3],order=1,version=0,normalization=0}={})=>box('SA3D',Buffer.from([version,0]),words(order),Buffer.from([0,normalization]),words(map.length,...map));
function track({pcm=false,count=3,channels=pcm?4:2,rate=48000,offset=32,offsets=[offset],chunkRules=[[1,count,1]],sizes=null,fixed=pcm?16:5,timing=[[count,pcm?1:1024]],spatial=pcm?sa3d():null,endian=1,edit=null,ctts=null,asc=Buffer.from([0x11,0x90]),esds=null,soundVersion=pcm?1:0,co64=false}={}){
 const h=Buffer.alloc(12);h.write('soun',8);const entry=Buffer.alloc(soundVersion?44:28);entry.writeUInt16BE(soundVersion,8);entry.writeUInt16BE(channels,16);entry.writeUInt32BE(rate*65536,24);
 const config=esds??box('esds',words(0),descriptor(3,Buffer.concat([Buffer.from([0,0,0]),descriptor(4,Buffer.concat([Buffer.from([0x40]),Buffer.alloc(12),descriptor(5,asc,true)]),true)]),true));
 const wave=box('wave',box('enda',Buffer.from([0,endian])));
 const chunkOffsets=co64?box('co64',words(0,offsets.length),...offsets.map(x=>{const b=Buffer.alloc(8);b.writeBigUInt64BE(BigInt(x));return b;})):box('stco',words(0,offsets.length,...offsets));
 const table=box('stbl',box('stsd',words(0,1),box(pcm?'in32':'mp4a',entry,pcm?wave:config,...(spatial?[spatial]:[]))),box('stsz',words(0,sizes?0:fixed,count,...(sizes||[]))),box('stts',words(0,timing.length,...timing.flat())),box('stsc',words(0,chunkRules.length,...chunkRules.flat())),chunkOffsets,...(ctts?[box('ctts',words(0,ctts.length,...ctts.flat()))]:[]));
 let edits=[];if(edit){const b=Buffer.alloc(20);b.writeUInt32BE(1,4);b.writeUInt32BE(edit.duration??1000,8);b.writeInt32BE(edit.start??1024,12);b.writeInt16BE(edit.rate??1,16);edits=[box('edts',box('elst',b))];}
 return box('trak',...edits,box('mdia',box('hdlr',h),box('mdhd',words(0,0,0,rate,count*(pcm?1:1024))),box('minf',table)));
}
function parse(options={},size=1e8){const data=Buffer.concat([box('mvhd',words(0,0,0,1000,10000)),track(options)]);return demuxAudioTracks(new DataView(data.buffer,data.byteOffset,data.length),size);}
const valid=(options,size)=>{const result=parse(options,size);assert.deepEqual(result.issues,[]);assert.equal(result.tracks.length,1);return result.tracks[0];};
const rejected=(options,pattern)=>{const result=parse(options);assert.equal(result.tracks.length,0);assert.match(result.issues[0],pattern);};
test('AAC nested/padded ESDS extraction preserves exact ASC and sample table timing',()=>{
 const t=valid({sizes:[5,7,9],offsets:[100,200],chunkRules:[[1,2,1],[2,1,1]]});
 assert.equal(t.kind,'aac');assert.equal(t.mode,'stereo');assert.deepEqual([...t.config.description],[0x11,0x90]);assert.equal(t.config.codec,'mp4a.40.2');
 assert.deepEqual(t.samples.map(s=>[s.offset,s.size,s.timestamp,s.duration]),[[100,5,0,21333],[105,7,21333,21334],[200,9,42667,21333]]);assert.equal(t.duration,.064);
});
test('AAC mono config and 64-bit chunk offsets are accepted only when consistent',()=>{
 const t=valid({channels:1,asc:Buffer.from([0x11,0x88]),co64:true,offset:2**32},2**33);assert.equal(t.mode,'mono');assert.equal(t.samples[0].offset,2**32);
});
test('AAC mismatched rates/channels, HE-AAC, invalid descriptors and unsupported sound versions fail closed',()=>{
 rejected({asc:Buffer.from([0x12,0x10])},/matching AAC/);rejected({channels:1},/matching AAC/);rejected({asc:Buffer.from([0x29,0x90])},/matching AAC/);
 rejected({esds:box('esds',words(0),Buffer.from([3,0x80,0x80,0x80,0x80]))},/descriptor/);rejected({esds:box('esds',words(0),Buffer.from([3,4,0]))},/descriptor/);rejected({soundVersion:2},/format/);
});
test('AAC edit trim yields negative priming timestamps and honors presentation duration',()=>{
 const t=valid({count:10,edit:{start:1024,duration:100}});assert.equal(t.samples[0].timestamp,-21333);assert.equal(t.samples[1].timestamp,0);assert.equal(t.duration,.1);
 rejected({edit:{start:-1}},/timeline edit/);rejected({edit:{rate:2}},/timeline edit/);
});
test('PCM groups long frame counts into <=4096-frame packets without losing offsets or timing',()=>{
 const count=1_100_003,t=valid({pcm:true,count});assert.equal(t.kind,'pcm-s32le');assert.equal(t.mode,'ambisonic');assert.equal(t.samples.length,Math.ceil(count/4096));assert.equal(t.samples.reduce((n,s)=>n+s.frames,0),count);
 assert.ok(t.samples.every(s=>s.frames<=4096&&s.size===s.frames*16));assert.equal(t.samples[1].offset,32+4096*16);assert.equal(t.samples.at(-1).offset+t.samples.at(-1).size,32+count*16);assert.equal(t.duration,count/48000);
 assert.equal(t.samples.at(-1).timestamp+t.samples.at(-1).duration,Math.round(count/48000*1e6));
});
test('PCM chunks retain physical boundaries and preserve final short blocks',()=>{
 const t=valid({pcm:true,count:10000,offsets:[100,1e6],chunkRules:[[1,5000,1]]});assert.deepEqual(t.samples.map(s=>s.frames),[4096,904,4096,904]);assert.deepEqual(t.samples.map(s=>s.offset),[100,65636,1e6,1065536]);
});
test('ambisonics require exact supported SA3D metadata, never only four channels',()=>{
 rejected({pcm:true,spatial:null},/no supported spatial/);rejected({pcm:true,spatial:sa3d({map:[0,2,3,1]})},/mapping/);rejected({pcm:true,spatial:sa3d({map:[0,1,1,3]})},/mapping/);rejected({pcm:true,spatial:sa3d({order:2})},/metadata/);rejected({pcm:true,spatial:sa3d({normalization:1})},/metadata/);rejected({pcm:true,spatial:sa3d({version:1})},/metadata/);
 assert.deepEqual(valid({pcm:true}).spatial,{order:1,ordering:'ACN',normalization:'SN3D',channelMap:[0,1,2,3]});
});
test('PCM big-endian, inconsistent byte stride and non-unit sample timing are rejected',()=>{
 rejected({pcm:true,endian:0},/little-endian/);rejected({pcm:true,fixed:8},/PCM packet layout/);rejected({pcm:true,timing:[[3,1024]]},/PCM packet layout/);
});
test('malformed sample sizes, offsets, chunk counts and decode/composition timing are rejected',()=>{
 rejected({count:0},/sample count/);rejected({fixed:0},/sample count/);rejected({fixed:33*1024*1024},/outside file/);rejected({offset:200_000_000},/outside file/);rejected({co64:true,offset:Number.MAX_SAFE_INTEGER+1},/outside file/);
 rejected({timing:[[2,1024]]},/timing/);rejected({timing:[[3,0]]},/timing/);rejected({chunkRules:[[2,3,1]]},/chunk map/);rejected({chunkRules:[[1,4,1]]},/exceed/);rejected({chunkRules:[[1,2,1]]},/Incomplete/);rejected({chunkRules:[[1,3,2]]},/chunk map/);
 rejected({ctts:[[3,1]]},/composition/);rejected({ctts:[[2,0]]},/composition/);assert.equal(valid({ctts:[[3,0]]}).samples.length,3);
});
