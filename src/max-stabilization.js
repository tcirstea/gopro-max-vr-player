import {readMovie,children,descend} from './inspect.js';
import {parseGpmfOrientation} from './gpmf.js';
import {IDENTITY_QUATERNION,normalizeQuaternion,multiplyQuaternion,conjugateQuaternion} from './quaternion.js';
const MAX_PACKETS=100000,MAX_PACKET_BYTES=1024*1024,CACHE_PACKETS=4;
// The inverse image orientation is applied to sampling rays, not to pixels.
// telemetry-parser's GoPro module composes CORI * IORI after negating
// raw X. Inverting and changing to our EAC viewer basis yields B(IORI * CORI),
// B(w,x,y,z)=(w,x,-y,-z). See STABILIZATION.md for evidence and limitations.
export function maxSamplingQuaternion(cori,iori){
 const [w,x,y,z]=multiplyQuaternion(normalizeQuaternion(iori),normalizeQuaternion(cori));
 return normalizeQuaternion([w,x,-y,-z]);
}
function need(v,p,path){const b=descend(v,p,path);if(!b)throw new Error(`Missing telemetry ${path.at(-1)} table.`);return b;}
function rows(v,b,stride){if(b.start+8>b.end)throw new Error('Truncated telemetry table.');const count=v.getUint32(b.start+4);if(count>MAX_PACKETS||b.start+8+count*stride>b.end)throw new Error('Oversized telemetry table.');return Array.from({length:count},(_,i)=>b.start+8+i*stride);}
export function telemetrySamples(v,fileSize){
 const candidates=[];
 for(const trak of children(v,0,v.byteLength).filter(x=>x.type==='trak')){
  const stbl=descend(v,trak,['mdia','minf','stbl']),sd=stbl&&descend(v,stbl,['stsd']);if(!sd||sd.start+8>sd.end)continue;
  const entries=children(v,sd.start+8,sd.end);if(!entries.some(e=>e.type==='gpmd'))continue;
  if(entries.length!==1||v.getUint32(sd.start+4)!==1)throw new Error('Unsupported telemetry descriptions.');
  const mdhd=need(v,trak,['mdia','mdhd']),version=v.getUint8(mdhd.start);if(version>1||mdhd.start+(version?32:20)>mdhd.end)throw new Error('Invalid telemetry timescale.');
  const scale=v.getUint32(mdhd.start+(version?20:12));if(!scale)throw new Error('Zero telemetry timescale.');
  const edits=descend(v,trak,['edts','elst']);if(edits){const ver=v.getUint8(edits.start),r=rows(v,edits,ver?20:12);if(ver>1||r.length>1||r.some(o=>(ver?Number(v.getBigInt64(o+8)):v.getInt32(o+4))!==0))throw new Error('Telemetry edit offsets are unsupported.');}
  const sz=need(v,stbl,['stsz']);if(sz.start+12>sz.end)throw new Error('Truncated telemetry sizes.');const fixed=v.getUint32(sz.start+4),count=v.getUint32(sz.start+8);
  if(!count||count>MAX_PACKETS||(!fixed&&sz.start+12+count*4>sz.end))throw new Error('Invalid telemetry sample count.');
  const samples=Array.from({length:count},(_,i)=>({size:fixed||v.getUint32(sz.start+12+4*i),offset:0,timestamp:0,duration:0}));
  if(samples.some(s=>!s.size||s.size>MAX_PACKET_BYTES))throw new Error('Telemetry packet exceeds the 1 MiB limit.');
  let index=0,ticks=0;
  for(const o of rows(v,need(v,stbl,['stts']),8)){const n=v.getUint32(o),delta=v.getUint32(o+4);if(!n||!delta||index+n>count)throw new Error('Invalid telemetry timing.');for(let j=0;j<n;j++){const sample=samples[index++];sample.timestamp=Math.round(ticks/scale*1e6);ticks+=delta;sample.duration=Math.round(ticks/scale*1e6)-sample.timestamp;}}
  if(index!==count||!Number.isSafeInteger(ticks))throw new Error('Incomplete telemetry timing.');
  const ctts=descend(v,stbl,['ctts']);if(ctts&&rows(v,ctts,8).some(o=>v.getUint32(o+4)!==0))throw new Error('Reordered telemetry is unsupported.');
  const co=descend(v,stbl,['stco'])||need(v,stbl,['co64']),wide=co.type==='co64';
  const offsets=rows(v,co,wide?8:4).map(o=>wide?Number(v.getBigUint64(o)):v.getUint32(o));
  const sc=rows(v,need(v,stbl,['stsc']),12).map(o=>({first:v.getUint32(o),count:v.getUint32(o+4),description:v.getUint32(o+8)}));
  if(!sc.length||sc[0].first!==1||sc.some((x,i)=>!x.count||x.description!==1||x.first>offsets.length||(i&&x.first<=sc[i-1].first)))throw new Error('Invalid telemetry chunks.');
  index=0;let rule=0;
  for(let i=0;i<offsets.length;i++){while(rule+1<sc.length&&sc[rule+1].first<=i+1)rule++;let offset=offsets[i];for(let j=0;j<sc[rule].count;j++){const s=samples[index++];if(!s||!Number.isSafeInteger(offset)||offset<0||offset+s.size>fileSize)throw new Error('Telemetry points outside the local file.');s.offset=offset;offset+=s.size;}}
  if(index!==count)throw new Error('Incomplete telemetry chunks.');candidates.push(samples);
 }
 if(candidates.length>1)throw new Error('Multiple GPMF tracks are unsupported.');return candidates[0]||null;
}
function indexAt(samples,timestamp){let lo=0,hi=samples.length;while(lo<hi){const mid=(lo+hi)>>1;if(samples[mid].timestamp<=timestamp)lo=mid+1;else hi=mid;}return Math.max(0,lo-1);}
export async function createMaxStabilization(file,videoSamples,readSample=async sample=>new Uint8Array(await file.slice(sample.offset,sample.offset+sample.size).arrayBuffer()),metadata){
 let closed=false,enabled=true,status='ready',reason=null,packets=null,base=null,reference=null,initial=null,generation=0;
 const cache=new Map(),pending=new Map(),stats={packetsRead:0,bytesRead:0,readMilliseconds:0,maxReadMilliseconds:0,preparedFrames:0,nonIdentityImageSamples:0};
 const disable=error=>{enabled=false;status='unavailable';reason=error.message;cache.clear();};
 const check=g=>{if(closed||g!==generation)throw new DOMException('Stabilization preparation was canceled.','AbortError');};
 try{if(metadata?.error)throw metadata.error;packets=metadata?metadata.samples:telemetrySamples((await readMovie(file)).moov,file.size);if(!packets){status='absent';enabled=false;}if(!videoSamples?.length)throw new Error('No video frame timeline.');}catch(error){disable(error);}
 async function packet(index,g){
  check(g);
  if(cache.has(index)){const value=cache.get(index);cache.delete(index);cache.set(index,value);return value;}
  if(pending.has(index))return pending.get(index);
  // A dedicated shared-input consumer permits one active sample read. Same
  // packet calls deduplicate; different packets serialize without aliasing video.
  while(pending.size){await Promise.race(pending.values());check(g);if(pending.has(index))return pending.get(index);if(cache.has(index))return cache.get(index);}
  const job=(async()=>{
   const readStart=performance.now(),bytes=await readSample(packets[index],index);check(g);const elapsed=performance.now()-readStart;stats.readMilliseconds+=elapsed;stats.maxReadMilliseconds=Math.max(stats.maxReadMilliseconds,elapsed);if(bytes.byteLength!==packets[index].size)throw new Error('Truncated GPMF packet.');
   const streams=parseGpmfOrientation(bytes),c=streams.filter(s=>s.key==='CORI'),i=streams.filter(s=>s.key==='IORI');
   if(c.length!==1||i.length!==1||c[0].total!==i[0].total||c[0].values.length!==i[0].values.length)throw new Error('Matching CORI and IORI streams are required.');
   const cori=c[0],iori=i[0],start=cori.total-cori.values.length;
   const value={start,count:cori.values.length,quaternions:cori.values.map((q,n)=>maxSamplingQuaternion(q,iori.values[n]))};
   stats.packetsRead++;stats.bytesRead+=bytes.byteLength;stats.nonIdentityImageSamples+=iori.values.filter(q=>Math.hypot(...q.slice(1))>1e-4).length;
   if(!closed&&enabled){cache.set(index,value);while(cache.size>CACHE_PACKETS)cache.delete(cache.keys().next().value);}return value;
  })();pending.set(index,job);try{return await job;}finally{if(pending.get(index)===job)pending.delete(index);}
 }
 async function prepare(timestamp){
  if(closed||!enabled)return null;
  const g=generation;
  try{
   if(!reference){
    if(!initial){const job=packet(0,g).then(first=>{check(g);base=first.start;reference=conjugateQuaternion(first.quaternions[0]);});initial=job;job.catch(()=>{if(initial===job)initial=null;});}
    await initial;
   }
   check(g);if(!enabled)return null;
   const frame=indexAt(videoSamples,timestamp);let guess=indexAt(packets,videoSamples[frame].timestamp),found=null;
   // MP4 packet time selects a nearby payload; TSMP gives the authoritative
   // encoded-frame ordinal. Never stretch the last packet or add STMP latency.
   for(let n=0;n<8;n++){
    const current=await packet(guess,g);check(g);const start=current.start-base,end=start+current.count;
    if(start<0||end>videoSamples.length+2)throw new Error('Unsupported GPMF frame counters.');
    if(frame>=start&&frame<end){found=current.quaternions[frame-start];break;}
    guess+=frame<start?-1:1;if(guess<0||guess>=packets.length)break;
   }
   if(!found)throw new Error('GPMF orientation does not cover this video frame.');
   check(g);if(!enabled)return null;stats.preparedFrames++;
   return normalizeQuaternion(multiplyQuaternion(found,reference));
  }catch(error){if(!closed&&g===generation&&error.name!=='AbortError')disable(error);return null;}
 }
 function reset(){generation++;pending.clear();initial=null;}
 return {prepare,reset,getDiagnostics(){return {status,enabled:enabled&&!closed,reason,...stats,inputStrategy:metadata?'shared-movie-input':'exact-packet',cachedPackets:cache.size,pendingPackets:pending.size,cacheLimitPackets:CACHE_PACKETS,frameAlignment:'encoded-frame-ordinal',horizonLeveling:false};},close(){closed=true;reset();cache.clear();reference=IDENTITY_QUATERNION;}};
}
