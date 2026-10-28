// Bounded audio-only ISO-BMFF tables. Channel count alone never implies ambisonics.
import {children,descend} from './inspect.js';
const MAX_PACKETS=1_000_000, MAX_BYTES=32*1024*1024;
const need=(v,p,path)=>{const b=descend(v,p,path);if(!b)throw new Error(`Missing audio ${path.at(-1)}.`);return b;};
function rows(v,b,stride){if(b.start+8>b.end)throw new Error('Truncated audio table.');const n=v.getUint32(b.start+4);if(n>MAX_PACKETS||b.start+8+n*stride>b.end)throw new Error('Oversized audio table.');return Array.from({length:n},(_,i)=>b.start+8+i*stride);}
function ascFromESDS(v,b){
 function walk(start,end,depth=0){if(depth>4)throw new Error('Invalid audio descriptors.');let at=start;while(at<end){const tag=v.getUint8(at++);let size=0,done=false;for(let n=0;n<4&&at<end;n++){const c=v.getUint8(at++);size=size*128+(c&127);if(!(c&128)){done=true;break;}}if(!done||at+size>end)throw new Error('Truncated audio descriptor.');const stop=at+size;if(tag===5)return new Uint8Array(v.buffer.slice(v.byteOffset+at,v.byteOffset+stop));let child=null;if(tag===3){if(at+3>stop)throw new Error('Truncated ES descriptor.');const flags=v.getUint8(at+2);let skip=3;if(flags&128)skip+=2;if(flags&64){if(at+skip>=stop)throw new Error('Truncated ES URL.');skip+=1+v.getUint8(at+skip);}if(flags&32)skip+=2;if(at+skip>stop)throw new Error('Truncated ES descriptor flags.');child=walk(at+skip,stop,depth+1);}else if(tag===4){if(size<13||v.getUint8(at)!==0x40)throw new Error('Only MPEG-4 AAC is supported.');child=walk(at+13,stop,depth+1);}if(child)return child;at=stop;}return null;}
 if(b.start+4>b.end)throw new Error('Truncated ESDS.');const bytes=walk(b.start+4,b.end);if(!bytes||bytes.length<2)throw new Error('Missing AAC AudioSpecificConfig.');return bytes;
}
export function parseSA3D(v,b,channels){
 if(!b)return null;
 if(b.end-b.start!==28||channels!==4||v.getUint8(b.start)!==0||v.getUint8(b.start+1)!==0||v.getUint32(b.start+2)!==1||v.getUint8(b.start+6)!==0||v.getUint8(b.start+7)!==0||v.getUint32(b.start+8)!==4)throw new Error('Unsupported spatial audio metadata.');
 const map=Array.from({length:4},(_,i)=>v.getUint32(b.start+12+i*4));
 // Deliberately require the unambiguous identity map used by original MAX.
 if(map.some((x,i)=>x!==i))throw new Error('Unsupported spatial channel mapping.');
 return {order:1,ordering:'ACN',normalization:'SN3D',channelMap:map};
}
function sampleTable(v,trak,fileSize,pcm){
 const stbl=need(v,trak,['mdia','minf','stbl']),md=need(v,trak,['mdia','mdhd']);
 const version=v.getUint8(md.start);if(version>1||md.start+(version?32:20)>md.end)throw new Error('Invalid audio media header.');
 const timescale=v.getUint32(md.start+(version?20:12));if(!timescale)throw new Error('Invalid audio timescale.');
 let offsetSeconds=0,editDuration=Infinity;const edit=descend(v,trak,['edts','elst']);if(edit){const ver=v.getUint8(edit.start),r=rows(v,edit,ver?20:12);if(ver>1||r.length!==1)throw new Error('Unsupported audio edit list.');const at=r[0],media=ver?Number(v.getBigInt64(at+8)):v.getInt32(at+4),rate=at+(ver?16:8);if(media<0||!Number.isSafeInteger(media)||v.getInt16(rate)!==1||v.getInt16(rate+2)!==0)throw new Error('Unsupported audio timeline edit.');offsetSeconds=media/timescale;const mv=children(v,0,v.byteLength).find(b=>b.type==='mvhd');if(!mv||mv.start+4>mv.end)throw new Error('Missing movie timescale for audio edit.');const mvVersion=v.getUint8(mv.start);if(mvVersion>1||mv.start+(mvVersion?32:20)>mv.end)throw new Error('Invalid movie timescale for audio edit.');const movieScale=v.getUint32(mv.start+(mvVersion?20:12)),duration=ver?Number(v.getBigUint64(at)):v.getUint32(at);if(!movieScale||!Number.isSafeInteger(duration))throw new Error('Invalid audio edit duration.');editDuration=duration/movieScale;}
 const sz=need(v,stbl,['stsz']);if(sz.start+12>sz.end)throw new Error('Truncated audio sizes.');const fixed=v.getUint32(sz.start+4),n=v.getUint32(sz.start+8);
 if(!n||(!pcm&&n>MAX_PACKETS)||(!fixed&&sz.start+12+n*4>sz.end))throw new Error('Oversized audio sample count.');
 const timing=rows(v,need(v,stbl,['stts']),8).map(at=>({count:v.getUint32(at),delta:v.getUint32(at+4)}));
 if(timing.some(r=>!r.count||!r.delta)||timing.reduce((s,r)=>s+r.count,0)!==n)throw new Error('Invalid audio timing.');
 if(pcm&&(fixed!==pcm.bytesPerFrame||timing.length!==1||timing[0].delta!==1||timescale!==pcm.sampleRate))throw new Error('Unsupported PCM packet layout.');
 const ctts=descend(v,stbl,['ctts']);if(ctts){const entries=rows(v,ctts,8);if(v.getUint8(ctts.start)>1||entries.some(at=>!v.getUint32(at)||v.getUint32(at+4)!==0)||entries.reduce((sum,at)=>sum+v.getUint32(at),0)!==n)throw new Error('Unsupported audio composition timing.');}
 const co=descend(v,stbl,['stco'])||need(v,stbl,['co64']),wide=co.type==='co64';const chunks=rows(v,co,wide?8:4).map(at=>wide?Number(v.getBigUint64(at)):v.getUint32(at));
 const sc=rows(v,need(v,stbl,['stsc']),12).map(at=>({first:v.getUint32(at),count:v.getUint32(at+4),description:v.getUint32(at+8)}));
 if(!sc.length||sc[0].first!==1||sc.some((r,i)=>!r.count||r.description!==1||r.first>chunks.length||(i&&r.first<=sc[i-1].first)))throw new Error('Invalid audio chunk map.');
 const samples=[];let index=0,rule=0,ticks=0,tr=0,remaining=timing[0].count;
 for(let c=0;c<chunks.length;c++){while(rule+1<sc.length&&sc[rule+1].first<=c+1)rule++;let offset=chunks[c];for(let j=0;j<sc[rule].count;){const count=pcm?Math.min(4096,sc[rule].count-j):1;if(index+count>n)throw new Error('Audio chunks exceed sample count.');const size=pcm?count*fixed:fixed||v.getUint32(sz.start+12+index*4);if(!size||size>MAX_BYTES||!Number.isSafeInteger(offset)||offset<0||offset+size>fileSize)throw new Error('Audio sample outside file.');const timestamp=Math.round((ticks/timescale-offsetSeconds)*1e6);let delta=0,left=count;while(left){const use=Math.min(left,remaining);delta+=use*timing[tr].delta;left-=use;remaining-=use;if(!remaining&&tr+1<timing.length)remaining=timing[++tr].count;}ticks+=delta;samples.push({offset,size,timestamp,duration:Math.round((ticks/timescale-offsetSeconds)*1e6)-timestamp,key:true,frames:pcm?count:undefined});if(samples.length>MAX_PACKETS)throw new Error('Too many audio packets.');index+=count;j+=count;offset+=size;}}
 if(index!==n||!Number.isSafeInteger(ticks))throw new Error('Incomplete audio chunks.');return {samples,duration:Math.min(editDuration,Math.max(0,ticks/timescale-offsetSeconds))};
}
export function demuxAudioTracks(v,fileSize){
 const tracks=[],issues=[];
 for(const trak of children(v,0,v.byteLength).filter(b=>b.type==='trak')){
  const h=descend(v,trak,['mdia','hdlr']);if(!h||h.start+12>h.end||v.getUint32(h.start+8)!==0x736f756e)continue;
  try{
   const sd=need(v,trak,['mdia','minf','stbl','stsd']);if(sd.start+8>sd.end||v.getUint32(sd.start+4)!==1)throw new Error('Unsupported audio descriptions.');
   const e=children(v,sd.start+8,sd.end)[0];if(!e||e.start+28>e.end)throw new Error('Truncated sound entry.');const ver=v.getUint16(e.start+8),channels=v.getUint16(e.start+16),sampleRate=v.getUint32(e.start+24)/65536;
   if(![0,1].includes(ver)||![1,2,4].includes(channels)||sampleRate<8000||sampleRate>96000||!Number.isInteger(sampleRate))throw new Error('Unsupported audio format.');
   const extra=children(v,e.start+(ver?44:28),e.end),spatial=parseSA3D(v,extra.find(b=>b.type==='SA3D'),channels);
   if(channels===4&&!spatial)throw new Error('Four-channel audio has no supported spatial metadata.');
   if(e.type==='mp4a'&&!spatial){const es=extra.find(b=>b.type==='esds');if(!es)throw new Error('Missing AAC configuration.');const description=ascFromESDS(v,es),objectType=description[0]>>3,freq=(description[0]&7)*2+(description[1]>>7),ch=(description[1]>>3)&15,rate=[96000,88200,64000,48000,44100,32000,24000,22050,16000,12000,11025,8000,7350][freq];if(objectType!==2||ch!==channels||rate!==sampleRate)throw new Error('Only matching AAC-LC mono/stereo is supported.');tracks.push({kind:'aac',mode:channels===1?'mono':'stereo',config:{codec:'mp4a.40.2',sampleRate,numberOfChannels:channels,description},channels,sampleRate,...sampleTable(v,trak,fileSize,null)});}
   else if(e.type==='in32'&&spatial&&ver===1){const wave=extra.find(b=>b.type==='wave'),enda=wave&&descend(v,wave,['enda']);if(!enda||enda.start+2>enda.end||v.getUint16(enda.start)!==1)throw new Error('Only little-endian spatial PCM is supported.');tracks.push({kind:'pcm-s32le',mode:'ambisonic',channels,sampleRate,spatial,...sampleTable(v,trak,fileSize,{bytesPerFrame:channels*4,sampleRate})});}
   else throw new Error('Unsupported audio codec.');
  }catch(error){issues.push(error.message);}
 }
 return {tracks,issues};
}
