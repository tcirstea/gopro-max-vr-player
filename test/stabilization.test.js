import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseGpmfOrientation} from '../src/gpmf.js';
import {maxSamplingQuaternion,createMaxStabilization} from '../src/max-stabilization.js';
import {normalizeQuaternion,multiplyQuaternion,conjugateQuaternion,quaternionMatrix,multiplyMatrix3,viewRotationMatrix} from '../src/quaternion.js';
const near=(a,b,e=1e-6)=>{assert.equal(a.length,b.length);a.forEach((x,i)=>assert.ok(Math.abs(x-b[i])<e,`${i}: ${x} != ${b[i]}`));};
const identity=[1,0,0,0],axis=(axis,angle)=>[Math.cos(angle/2),...Array.from({length:3},(_,i)=>i===axis?Math.sin(angle/2):0)];
const box=(type,...parts)=>{const p=Buffer.concat(parts),h=Buffer.alloc(8);h.writeUInt32BE(p.length+8);h.write(type,4);return Buffer.concat([h,p]);};
const words=(...n)=>{const b=Buffer.alloc(n.length*4);n.forEach((x,i)=>b.writeUInt32BE(x,i*4));return b;};
const klv=(key,type,size,count,raw)=>{const h=Buffer.alloc(8),data=Buffer.alloc(Math.ceil(raw.length/4)*4);h.write(key);h[4]=type.charCodeAt(0);h[5]=size;h.writeUInt16BE(count,6);raw.copy(data);return Buffer.concat([h,data]);};
const nested=(key,...items)=>{const raw=Buffer.concat(items);return klv(key,'\0',1,raw.length,raw);};
function packet(cori,iori=cori.map(()=>identity),total=cori.length,{scale=32767,stamp=151599}={}){
 const stream=(key,values)=>{const raw=Buffer.alloc(values.length*8);values.flat().forEach((x,i)=>raw.writeInt16BE(Math.round(x*scale),i*2));const scal=Buffer.alloc(2);scal.writeInt16BE(scale);const stmp=Buffer.alloc(8);stmp.writeBigUInt64BE(BigInt(stamp));return nested('STRM',klv('STMP','J',8,1,stmp),klv('TSMP','L',4,1,words(total)),klv('SCAL','s',2,1,scal),klv(key,'s',8,values.length,raw));};
 return nested('DEVC',stream('CORI',cori),stream('IORI',iori));
}
function fixture(packets,{offset=8,delta=1000}={}){
 const data=Buffer.concat(packets),stbl=box('stbl',box('stsd',words(0,1),box('gpmd',Buffer.alloc(8))),box('stsz',words(0,0,packets.length,...packets.map(x=>x.length))),box('stts',words(0,1,packets.length,delta)),box('stsc',words(0,1,1,packets.length,1)),box('stco',words(0,1,offset)));
 return new File([box('mdat',data),box('moov',box('trak',box('mdia',box('mdhd',words(0,0,0,1000,packets.length*delta)),box('minf',stbl))))],'synthetic.360');
}
const frames=n=>Array.from({length:n},(_,i)=>({timestamp:i*40000,duration:40000}));
test('GPMF scalar divisor and stream-local counters decode signed scalar-first quaternions',()=>{
 const streams=parseGpmfOrientation(packet([identity,axis(0,.3)]));assert.deepEqual(streams.map(s=>[s.key,s.total,s.values.length]),[['CORI',2,2],['IORI',2,2]]);near(streams[0].values[1],axis(0,.3),1/32767);assert.equal(streams[0].stamp,151599);
});
test('GPMF malformed nesting, zero scale and non-unit quaternion are rejected',()=>{
 const p=packet([identity]);assert.throws(()=>parseGpmfOrientation(p.subarray(0,p.length-1)),/length/);assert.throws(()=>parseGpmfOrientation(packet([identity],undefined,1,{scale:0})),/shape/);assert.throws(()=>parseGpmfOrientation(packet([[0,0,0,0]])),/norm/);let deep=klv('SCAL','s',2,1,Buffer.from([0,1]));for(let i=0;i<10;i++)deep=nested('DEVC',deep);assert.throws(()=>parseGpmfOrientation(deep),/nesting/);
});
test('sampling quaternion implements inverse CORI/IORI camera product, with noncommuting axes',()=>{
 const c=axis(0,.4),i=axis(1,.8),source=q=>[q[0],-q[1],q[2],q[3]];
 const expected=conjugateQuaternion(multiplyQuaternion(source(c),source(i)));
 near(maxSamplingQuaternion(c,i),expected);assert.ok(Math.abs(maxSamplingQuaternion(c,i)[3]-maxSamplingQuaternion(i,c)[3])>.1);
});
test('quaternion normalization and matrix composition agree',()=>{
 const q=axis(1,.7);near(normalizeQuaternion(q.map(x=>x*3)),q);
 near(multiplyMatrix3(quaternionMatrix(q),quaternionMatrix(axis(0,.2))),quaternionMatrix(multiplyQuaternion(q,axis(0,.2))));near(viewRotationMatrix(.7,.2),quaternionMatrix(multiplyQuaternion(q,axis(0,.2))));assert.throws(()=>normalizeQuaternion([0,0,0,0]),/Zero/);assert.throws(()=>normalizeQuaternion([1,NaN,0,0]),/Invalid/);
});
test('frame ordinal alignment ignores STMP offset and padded metadata packet duration',async()=>{
 const qs=[axis(0,.1),axis(0,.2),axis(0,.3),axis(0,.4),axis(0,.5)];
 const file=fixture([packet(qs.slice(0,2),undefined,102),packet(qs.slice(2),undefined,105,{stamp:2222222})]);
 let reads=0;const s=await createMaxStabilization(file,frames(4),async p=>{reads++;return new Uint8Array(await file.slice(p.offset,p.offset+p.size).arrayBuffer());});
 assert.equal(reads,0,'metadata initialization does not scan payloads');near(await s.prepare(0),identity);
 near(await s.prepare(120000),axis(0,.3),.0001);near(await s.prepare(40000),axis(0,.1),.0001);
 assert.equal(reads,2);assert.equal(s.getDiagnostics().frameAlignment,'encoded-frame-ordinal');assert.equal(s.getDiagnostics().horizonLeveling,false);s.close();assert.equal(await s.prepare(0),null);
});
test('missing and malformed metadata fail open rather than break video',async()=>{
 const absent=new File([box('moov')],'no-telemetry.360'),s=await createMaxStabilization(absent,frames(2));assert.equal(await s.prepare(0),null);assert.equal(s.getDiagnostics().status,'absent');
 const broken=await createMaxStabilization(fixture([packet([identity])],{offset:999999}),frames(2));assert.equal(await broken.prepare(0),null);assert.match(broken.getDiagnostics().reason,/outside/);
 const corrupt=await createMaxStabilization(fixture([Buffer.alloc(16)]),frames(2));assert.equal(await corrupt.prepare(0),null);assert.equal(corrupt.getDiagnostics().status,'unavailable');
});
test('bounded telemetry cache handles distant seeks and close during pending input',async()=>{
 const qs=Array.from({length:10},(_,i)=>axis(0,i*.02));const file=fixture(qs.map((q,i)=>packet([q],undefined,i+1)),{delta:40});
 let reads=0;const s=await createMaxStabilization(file,frames(10),async p=>{reads++;return new Uint8Array(await file.slice(p.offset,p.offset+p.size).arrayBuffer());});
 for(let i=0;i<10;i++){near(await s.prepare(i*40000),axis(0,i*.02),.0001);assert.ok(s.getDiagnostics().cachedPackets<=4);}near(await s.prepare(40000),axis(0,.02),.0001);assert.equal(reads,11);s.close();
 let finish;const pending=await createMaxStabilization(file,frames(10),p=>new Promise(resolve=>{finish=async()=>resolve(new Uint8Array(await file.slice(p.offset,p.offset+p.size).arrayBuffer()));}));const result=pending.prepare(0);pending.close();await finish();assert.equal(await result,null);assert.equal(pending.getDiagnostics().cachedPackets,0);
});
test('concurrent preparation shares its initial read and consistently retains first-frame reference',async()=>{
 const file=fixture([packet([axis(2,.1),axis(2,.2)])]);let reads=0;
 const s=await createMaxStabilization(file,frames(2),async p=>{reads++;await new Promise(resolve=>setImmediate(resolve));return new Uint8Array(await file.slice(p.offset,p.offset+p.size).arrayBuffer());});
 const [a,b]=await Promise.all([s.prepare(0),s.prepare(40000)]);near(a,identity);near(b,axis(2,-.1),.0001);assert.equal(reads,1);s.close();
});
test('a canceled input read does not permanently disable stabilization after seeking',async()=>{
 const file=fixture([packet([identity,axis(1,.2)])]);let first=true;
 const s=await createMaxStabilization(file,frames(2),async p=>{if(first){first=false;throw new DOMException('Seek canceled','AbortError');}return new Uint8Array(await file.slice(p.offset,p.offset+p.size).arrayBuffer());});
 assert.equal(await s.prepare(0),null);assert.equal(s.getDiagnostics().enabled,true);near(await s.prepare(40000),axis(1,-.2),.0001);s.close();
});

test('seek during initial telemetry read cannot inherit an obsolete promise or delete its replacement',async()=>{
 const file=fixture([packet([axis(0,.1),axis(0,.3)])]),requests=[];
 const s=await createMaxStabilization(file,frames(2),sample=>new Promise(resolve=>requests.push(async()=>resolve(new Uint8Array(await file.slice(sample.offset,sample.offset+sample.size).arrayBuffer())))));
 const stale=s.prepare(0);assert.equal(requests.length,1);s.reset();const current=s.prepare(40000);assert.equal(requests.length,2);
 await requests[0]();assert.equal(await stale,null);assert.equal(s.getDiagnostics().pendingPackets,1);assert.equal(s.getDiagnostics().cachedPackets,0);
 await requests[1]();near(await current,axis(0,.2),.0001);assert.equal(s.getDiagnostics().enabled,true);assert.equal(s.getDiagnostics().packetsRead,1);s.close();
});

test('seek during a later telemetry read keeps the first-frame reference and rejects stale cache writes',async()=>{
 const file=fixture([.1,.2,.3].map((a,i)=>packet([axis(0,a)],undefined,i+1)),{delta:40}),requests=[];
 const s=await createMaxStabilization(file,frames(3),(sample,index)=>new Promise(resolve=>requests.push({index,finish:async()=>resolve(new Uint8Array(await file.slice(sample.offset,sample.offset+sample.size).arrayBuffer()))})));
 const first=s.prepare(0);await requests[0].finish();near(await first,identity);
 const stale=s.prepare(40000);s.reset();const current=s.prepare(80000);
 assert.deepEqual(requests.map(r=>r.index),[0,1,2]);await requests[1].finish();assert.equal(await stale,null);assert.equal(s.getDiagnostics().pendingPackets,1);
 await requests[2].finish();near(await current,axis(0,.2),.0001);assert.equal(s.getDiagnostics().cachedPackets,2);assert.equal(s.getDiagnostics().enabled,true);s.close();
});

test('concurrent preparations serialize distinct packets for the dedicated shared-input consumer',async()=>{
 const file=fixture([0,.1,.2].map((a,i)=>packet([axis(0,a)],undefined,i+1)),{delta:40});let active=0,maxActive=0;
 const s=await createMaxStabilization(file,frames(3),async sample=>{active++;maxActive=Math.max(maxActive,active);await new Promise(resolve=>setImmediate(resolve));const bytes=new Uint8Array(await file.slice(sample.offset,sample.offset+sample.size).arrayBuffer());active--;return bytes;});
 await s.prepare(0);const [a,b]=await Promise.all([s.prepare(40000),s.prepare(80000)]);near(a,axis(0,.1),.0001);near(b,axis(0,.2),.0001);assert.equal(maxActive,1);assert.equal(s.getDiagnostics().pendingPackets,0);s.close();
});
