// Original, bounded ISO-BMFF sample demuxer. Metadata inspection skips video payload.
import {readMovie, children, descend} from './inspect.js';
import {createChunkedInput} from './chunked-input.js';
import {demuxAudioTracks} from './audio-demux.js';
import {telemetrySamples} from './max-stabilization.js';
const MAX_SAMPLES=1_000_000, MAX_SAMPLE_BYTES=32*1024*1024;
export const READ_AHEAD_BYTES=4*1024*1024;
// File-backed Blob reads can incur a task/IPC round trip per call. Amortize that
// cost over a bounded window instead of awaiting a fresh read for every frame.
// One reader per track prevents distant/interleaved tracks evicting each other.
export function createSampleReader(file,windowBytes=READ_AHEAD_BYTES){
 let cached=null,cacheStart=0,request=0;
 const stats={readOperations:0,bytesRead:0,cacheHits:0,readMilliseconds:0,maxReadMilliseconds:0};
 return {
  async read(sample){
   const token=++request;
   const {offset,size}=sample;
   if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(size)||offset<0||size<=0||size>MAX_SAMPLE_BYTES||offset+size>file.size)throw new Error('Sample points outside the local file or exceeds the safety limit.');
   if(cached&&offset>=cacheStart&&offset+size<=cacheStart+cached.byteLength){stats.cacheHits++;return new Uint8Array(cached,offset-cacheStart,size);}
   // Large samples use an exact read and are not retained in the cache.
   const end=Math.min(file.size,offset+Math.max(size,windowBytes));
   const start=performance.now();stats.readOperations++;
   const data=await file.slice(offset,end).arrayBuffer();
   const elapsed=performance.now()-start;stats.readMilliseconds+=elapsed;stats.maxReadMilliseconds=Math.max(stats.maxReadMilliseconds,elapsed);stats.bytesRead+=data.byteLength;
   if(data.byteLength!==end-offset)throw new Error('Truncated video sample read window.');
   if(token===request){if(size<=windowBytes){cached=data;cacheStart=offset;}else{cached=null;}}
   // Use this call's buffer, not shared cache state: seek reads can overlap.
   return new Uint8Array(data,0,size);
  },
  getDiagnostics(){return {...stats,cachedBytes:cached?.byteLength||0,readAheadBytes:windowBytes};},
  clear(){request++;cached=null;}
 };
}
// Short clips can cost more to read than to decode. Stage a single bounded
// local copy before supplying either decoder; long recordings remain streamed.
export const SMALL_FILE_PRELOAD_BYTES=64*1024*1024;
export function createMovieInput(file,tracks=[]){
 if(file.size>SMALL_FILE_PRELOAD_BYTES){
  const input=createChunkedInput(file,{tracks});
  return {read:(...args)=>input.read(...args),reset:()=>input.reset(),close:()=>input.close(),getReadDiagnostics:()=>[input.getDiagnostics()],getInputState:()=>({...input.getInputState(),preloadLimitBytes:SMALL_FILE_PRELOAD_BYTES})};
 }
 const reader=createSampleReader(file,SMALL_FILE_PRELOAD_BYTES);
 let preparation=null,ready=false,closed=false;
 return {
  async read(sample){
   if(closed)throw new Error('Local video input is closed.');
   // The one-byte sample asks the reader for its whole bounded window. Both
   // tracks await this same promise; seeking reuses the prepared local bytes.
   preparation??=reader.read({offset:0,size:1}).then(()=>{if(!closed)ready=true;});
   await preparation;
   if(closed)throw new Error('Local video input is closed.');
   return reader.read(sample);
  },
  getReadDiagnostics(){return [reader.getDiagnostics()];},
  getInputState(){return {strategy:'preload-small-file',preparing:!ready&&!closed,preloadLimitBytes:SMALL_FILE_PRELOAD_BYTES};},
  reset(){}, // Prepared short clips remain reusable across seeks.
  close(){closed=true;reader.clear();preparation=null;}
 };
}
function requireBox(v,p,path){const b=descend(v,p,path);if(!b)throw new Error(`Missing ${path.join('/')} table.`);return b;}
function table(v,b,stride){if(b.start+8>b.end)throw new Error('Truncated sample table.');const n=v.getUint32(b.start+4);if(n>MAX_SAMPLES||b.start+8+n*stride>b.end)throw new Error('Invalid or oversized sample table.');return Array.from({length:n},(_,i)=>b.start+8+i*stride);}
export function hevcCodec(bytes, prefix='hvc1'){
 if(bytes.length<23||bytes[0]!==1)throw new Error('Invalid HEVC decoder configuration.');
 const profile=bytes[1],space=['','A','B','C'][profile>>6];let compatibility=0;
 for(let i=0;i<32;i++)if(bytes[2+(i>>3)]&(1<<(7-(i&7))))compatibility+=2**i;
 const constraints=Array.from(bytes.slice(6,12));while(constraints.length&&constraints.at(-1)===0)constraints.pop();
 return `${prefix}.${space}${profile&31}.${compatibility.toString(16).toUpperCase()}.${profile&32?'H':'L'}${bytes[12]}${constraints.map(x=>'.'+x.toString(16).toUpperCase()).join('')}`;
}
export async function demuxNative(file){
 const {moov:v}=await readMovie(file);const tracks=[];
 for(const trak of children(v,0,v.byteLength).filter(b=>b.type==='trak')){
  const h=descend(v,trak,['mdia','hdlr']);if(!h||h.start+12>h.end||v.getUint32(h.start+8)!==0x76696465)continue;
  const stbl=requireBox(v,trak,['mdia','minf','stbl']),sd=requireBox(v,stbl,['stsd']);
  if(sd.start+8>sd.end||v.getUint32(sd.start+4)!==1)throw new Error('Only single-description video tracks are supported.');
  const entry=children(v,sd.start+8,sd.end)[0];
  if(!entry||!['hvc1','hev1'].includes(entry.type)||entry.start+78>entry.end)throw new Error('Native playback requires two HEVC video tracks.');
  const hvcc=children(v,entry.start+78,entry.end).find(b=>b.type==='hvcC');if(!hvcc)throw new Error('Missing HEVC configuration.');
  const description=new Uint8Array(v.buffer.slice(v.byteOffset+hvcc.start,v.byteOffset+hvcc.end));
  const mdhd=requireBox(v,trak,['mdia','mdhd']),version=v.getUint8(mdhd.start);if(version>1||mdhd.start+(version?32:20)>mdhd.end)throw new Error('Invalid media timescale.');
  const timescale=v.getUint32(mdhd.start+(version?20:12));if(!timescale)throw new Error('Invalid zero timescale.');
  const edits=descend(v,trak,['edts','elst']);if(edits){const ver=v.getUint8(edits.start),rows=table(v,edits,ver?20:12);if(ver>1||rows.length>1||rows.some(o=>(ver?Number(v.getBigInt64(o+8)):v.getInt32(o+4))!==0))throw new Error('Nonzero edit-list offsets are not yet supported.');}
  const sz=requireBox(v,stbl,['stsz']);if(sz.start+12>sz.end)throw new Error('Truncated sample sizes.');const fixed=v.getUint32(sz.start+4),n=v.getUint32(sz.start+8);
  if(!n||n>MAX_SAMPLES||(!fixed&&sz.start+12+4*n>sz.end))throw new Error('Invalid or oversized sample count.');
  const samples=Array.from({length:n},(_,i)=>({size:fixed||v.getUint32(sz.start+12+i*4),offset:0,timestamp:0,duration:0,key:false}));
  if(samples.some(s=>!s.size||s.size>MAX_SAMPLE_BYTES))throw new Error('Video sample exceeds the 32 MiB safety limit.');
  let index=0,ticks=0;const stts=requireBox(v,stbl,['stts']);
  for(const o of table(v,stts,8)){const count=v.getUint32(o),delta=v.getUint32(o+4);if(!count||!delta||index+count>n)throw new Error('Invalid decoding timestamps.');for(let j=0;j<count;j++){const s=samples[index++];s.timestamp=Math.round(ticks/timescale*1e6);ticks+=delta;s.duration=Math.round(ticks/timescale*1e6)-s.timestamp;}}
  if(index!==n||!Number.isSafeInteger(ticks))throw new Error('Incomplete decoding timestamps.');
  const ctts=descend(v,stbl,['ctts']);if(ctts){let count=0;for(const o of table(v,ctts,8)){count+=v.getUint32(o);if(v.getUint32(o+4)!==0)throw new Error('Reordered HEVC timestamps are not yet supported.');}if(count!==n)throw new Error('Invalid composition timestamps.');}
  const sync=descend(v,stbl,['stss']);if(sync){for(const o of table(v,sync,4)){const i=v.getUint32(o)-1;if(i<0||i>=n)throw new Error('Invalid sync sample.');samples[i].key=true;}}else samples.forEach(s=>s.key=true);
  if(!samples[0].key)throw new Error('Video does not begin with a sync sample.');
  const co=descend(v,stbl,['stco'])||requireBox(v,stbl,['co64']),wide=co.type==='co64';
  const chunks=table(v,co,wide?8:4).map(o=>wide?Number(v.getBigUint64(o)):v.getUint32(o));
  const sc=table(v,requireBox(v,stbl,['stsc']),12).map(o=>({first:v.getUint32(o),count:v.getUint32(o+4),description:v.getUint32(o+8)}));
  if(!sc.length||sc[0].first!==1||sc.some((x,i)=>!x.count||x.description!==1||x.first>chunks.length||(i&&x.first<=sc[i-1].first)))throw new Error('Invalid sample-to-chunk table.');
  index=0;let rule=0;
  for(let i=0;i<chunks.length;i++){while(rule+1<sc.length&&sc[rule+1].first<=i+1)rule++;let offset=chunks[i];for(let j=0;j<sc[rule].count;j++){const s=samples[index++];if(!s||!Number.isSafeInteger(offset)||offset<0||offset+s.size>file.size)throw new Error('Sample points outside the local file.');s.offset=offset;offset+=s.size;}}
  if(index!==n)throw new Error('Incomplete chunk table.');
  tracks.push({config:{codec:hevcCodec(description,entry.type),codedWidth:v.getUint16(entry.start+24),codedHeight:v.getUint16(entry.start+26),description},samples,duration:ticks/timescale});
 }
 if(tracks.length!==2)throw new Error('Expected exactly two native MAX video tracks.');
 if(tracks.some(t=>t.config.codedWidth!==4096||t.config.codedHeight!==1344))throw new Error('This experimental MAX layout currently supports 4096 × 1344 tracks only.');
 const audio=demuxAudioTracks(v,file.size);audio.tracks.forEach((track,i)=>track.inputIndex=tracks.length+i);
 // Telemetry is a separate consumer, but shares physical input chunks with
 // video/audio. Exact Blob reads here would stall track 0 once per packet.
 let telemetry;try{telemetry={samples:telemetrySamples(v,file.size)};}catch(error){telemetry={error};}
 const inputs=[...tracks,...audio.tracks];if(telemetry.samples){telemetry.inputIndex=inputs.length;inputs.push(telemetry);}
 return {tracks,audioTracks:audio.tracks,audioIssues:audio.issues,telemetry,duration:Math.min(...tracks.map(t=>t.duration)),...createMovieInput(file,inputs)};
}
