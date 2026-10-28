// Bounded, local-only GPMF reader. Only orientation streams are retained; GPS,
// serial numbers and other private telemetry are deliberately never returned.
const MAX_PAYLOAD_BYTES=1024*1024,MAX_RECORDS=20000,MAX_DEPTH=8;
const numeric={b:[1,'getInt8'],B:[1,'getUint8'],s:[2,'getInt16'],S:[2,'getUint16'],l:[4,'getInt32'],L:[4,'getUint32'],f:[4,'getFloat32'],d:[8,'getFloat64'],J:[8,'getBigUint64'],j:[8,'getBigInt64']};
export function parseGpmfOrientation(bytes){
 if(bytes.byteLength>MAX_PAYLOAD_BYTES)throw new Error('GPMF packet exceeds the 1 MiB limit.');
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let records=0;
 const ascii=(o,n)=>String.fromCharCode(...new Uint8Array(v.buffer,v.byteOffset+o,n));
 function walk(start,end,depth){
  if(depth>MAX_DEPTH)throw new Error('GPMF nesting exceeds the safety limit.');
  const out=[];let offset=start;
  while(offset<end){
   if(++records>MAX_RECORDS||offset+8>end)throw new Error('Truncated or oversized GPMF structure.');
   const key=ascii(offset,4),type=ascii(offset+4,1),size=v.getUint8(offset+5),count=v.getUint16(offset+6),length=size*count,data=offset+8,next=data+Math.ceil(length/4)*4;
   if(!size||next>end)throw new Error('Invalid GPMF record length.');
   if(type==='\0'){out.push({key,children:walk(data,data+length,depth+1)});}
   else if(['SCAL','TSMP','STMP','CORI','IORI'].includes(key)){
    const spec=numeric[type];if(!spec||size%spec[0])throw new Error('Unsupported GPMF orientation type.');
    const values=[];for(let o=data;o<data+length;o+=spec[0]){const x=Number(v[spec[1]](o));if(!Number.isFinite(x)||((type==='J'||type==='j')&&!Number.isSafeInteger(x)))throw new Error('Invalid GPMF numeric value.');values.push(x);}
    out.push({key,size,count,width:size/spec[0],values});
   }
   offset=next;
  }
  return out;
 }
 const streams=[];
 function collect(nodes){for(const node of nodes){if(node.key==='STRM'){
   const fields=node.children||[],scal=fields.find(x=>x.key==='SCAL')?.values,total=fields.find(x=>x.key==='TSMP')?.values[0],stamp=fields.find(x=>x.key==='STMP')?.values[0];
   for(const field of fields.filter(x=>x.key==='CORI'||x.key==='IORI')){
    if(field.width!==4||!field.count||!Number.isSafeInteger(total)||total<field.count||!scal||![1,4].includes(scal.length)||scal.some(x=>!Number.isFinite(x)||x===0))throw new Error('Unsupported GPMF orientation shape or counter.');
    const values=Array.from({length:field.count},(_,i)=>field.values.slice(i*4,i*4+4).map((x,j)=>x/scal[j%scal.length]));
    if(values.some(q=>Math.abs(Math.hypot(...q)-1)>.05))throw new Error('Invalid GPMF orientation norm.');
    streams.push({key:field.key,total,stamp,values});
   }
  }else if(node.children)collect(node.children);}}
 collect(walk(0,v.byteLength,0));return streams;
}
