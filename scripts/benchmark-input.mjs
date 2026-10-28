// Deterministic storage model, NOT a measurement of HEVC or real-device FPS.
// Models 1200 MiB of interleaved 128 KiB samples at 30 paired frames/second,
// one shared 16 MiB/s disk, and 20 ms overhead per physical Blob read.
import assert from 'node:assert/strict';
import {createSampleReader,createMovieInput} from '../src/native-demux.js';

const MiB=1024*1024,size=Math.round(1200*MiB),sampleBytes=128*1024;
const tracks=[{samples:[]},{samples:[]}];
for(let offset=0,index=0;offset<size;offset+=sampleBytes,index++)tracks[index%2].samples.push({offset,size:Math.min(sampleBytes,size-offset)});
const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
class Disk{
 now=0;available=0;jobs=[];operations=0;bytes=0;
 file={size,slice:(start,end)=>({arrayBuffer:()=>new Promise(resolve=>{
  assert.ok(end-start<=64*MiB,'never reads the whole recording');
  this.operations++;this.bytes+=end-start;
  const at=Math.max(this.now,this.available)+20+(end-start)/(16*MiB)*1000;this.available=at;
  this.jobs.push({at,finish:()=>resolve(new ArrayBuffer(end-start))});
 })})};
 async advanceTo(target){
  await settle();
  while(this.jobs.length&&this.jobs[0].at<=target){const job=this.jobs.shift();this.now=job.at;job.finish();await settle();}
  this.now=target;
 }
}
async function run(strategy){
 const disk=new Disk();
 const readers=strategy==='previous-4-MiB'?[createSampleReader(disk.file),createSampleReader(disk.file)]:null;
 const input=readers?{read:(sample,track)=>readers[track].read(sample),close:()=>readers.forEach(reader=>reader.clear())}:createMovieInput(disk.file,tracks);
 let waitMilliseconds=0,initialWaitMilliseconds=0,playbackStalls=0;
 for(let index=0;index<Math.max(...tracks.map(track=>track.samples.length));index++){
  const start=disk.now;let done=false,error;
  const read=Promise.all(tracks.flatMap((track,trackIndex)=>track.samples[index]?[input.read(track.samples[index],trackIndex,index)]:[])).then(()=>{done=true;},reason=>{done=true;error=reason;});
  await settle();
  while(!done){assert.ok(disk.jobs.length,'reader must either finish or have scheduled storage I/O');await disk.advanceTo(disk.jobs[0].at);}
  await read;if(error)throw error;
  const wait=disk.now-start;waitMilliseconds+=wait;if(index===0)initialWaitMilliseconds=wait;else if(wait>0)playbackStalls++;
  await disk.advanceTo(disk.now+1000/30);
 }
 const stats=readers?null:input.getReadDiagnostics()[0];
 const result={strategy,fileMiB:size/MiB,physicalReads:disk.operations,physicalMiB:Number((disk.bytes/MiB).toFixed(2)),initialWaitSeconds:Number((initialWaitMilliseconds/1000).toFixed(3)),playbackStalls,totalReadWaitSeconds:Number((waitMilliseconds/1000).toFixed(3)),modeledCompletionSeconds:Number((disk.now/1000).toFixed(3)),...(stats?{maxReservedMiB:stats.maxReservedBytes/MiB,maxConcurrentReads:stats.maxActiveReads,prefetchHits:stats.prefetchHits}:{})};
 input.close();while(disk.jobs.length)await disk.advanceTo(disk.jobs[0].at);
 return result;
}
const previous=await run('previous-4-MiB'),current=await run('shared-64-MiB-prefetch');
assert.equal(current.physicalReads,Math.ceil(size/(64*MiB)));
assert.ok(current.maxReservedMiB<=256);assert.ok(current.maxConcurrentReads<=2);
assert.ok(current.physicalReads<previous.physicalReads);assert.ok(current.totalReadWaitSeconds<previous.totalReadWaitSeconds);
console.log(JSON.stringify({model:'Synthetic serial 16 MiB/s disk + 20 ms/read; 30 paired FPS. Not real-device playback performance.',previous,current},null,2));
