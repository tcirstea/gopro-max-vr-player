import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlaybackDiagnostics,downloadPlaybackDiagnostics} from '../src/spatial/playback-diagnostics.mjs';

test('spatial playback diagnostics separate batch turnaround, presentation, and actual stalls', () => {
  let t=0;
  const diag=createPlaybackDiagnostics({threads:4,width:960,shader:true,mirror:false},()=>t);
  diag.source(30);
  diag.actualShader(true);
  t=210; diag.batch({requested:6,pairs:6,workerMs:200,roundTripMs:210,queue:6,stages:{decodeMs:165,copyMs:14}});
  diag.frame({queue:6,xr:true}); diag.present({costMs:3,queue:5});
  t=243; diag.frame({queue:5,xr:true}); diag.present({costMs:4,queue:4});
  t=310; diag.frame({queue:0,xr:true}); diag.stall(true); diag.stall(true);
  t=800; assert.equal(diag.snapshot().playback.activeStallMs,490);
  t=970; diag.stall(false); diag.stall(false);
  diag.resetCadence(); t=2000; diag.frame({queue:15,xr:false});
  const result=diag.snapshot();
  assert.equal(result.sourceFPS,30);
  assert.deepEqual(result.configuration,{threads:4,outputWidth:960,shader:true,shaderActive:true,mirror:false});
  assert.equal(result.worker.workPairsPerSecond,30);
  assert.equal(result.worker.roundTripPairsPerSecond,28.571);
  assert.equal(result.worker.turnaroundOverheadMs.mean,10);
  assert.equal(result.worker.stages.decodeMs.mean,165);
  assert.equal(result.playback.queuePairs.min,0);
  assert.equal(result.playback.bufferStallCount,1);
  assert.equal(result.playback.completedStallMs.max,660);
  assert.equal(result.playback.completedStallMs.total,660);
  assert.equal(result.playback.activeStallMs,null);
  assert.equal(result.render.xrFrames,3);
  assert.equal(result.render.desktopFrames,1);
  assert.equal(result.render.callbackGapMs.max,67);
  assert.equal(result.render.presentGapMs.mean,33);
  assert.equal(result.render.displaySubmitMs.mean,3.5);
});

test('histories stay bounded and chronological without persisting private fields', () => {
  let t=0;
  const diag=createPlaybackDiagnostics({threads:1,width:960,file:'private.mov',shader:true},()=>t);
  for (let i=0;i<100;i++) {
    t+=40;
    diag.batch({pairs:1, workerMs:30,roundTripMs:40,queue:i,stages:{decodeMs:20,path:'private.mov'}});
    diag.frame({queue:i,xr:true}); diag.present({costMs:2,queue:i});
    diag.stall(true); t+=1; diag.stall(false);
  }
  const result=diag.snapshot();
  assert.equal(result.decodedPairs,100);
  assert.equal(result.worker.recentBatches.length,96);
  assert.equal(result.worker.recentBatches[0].queue,4);
  assert.equal(result.worker.recentBatches.at(-1).queue,99);
  assert.equal(result.render.recentLongGaps.length,96);
  assert.equal(result.playback.recentStalls.length,96);
  assert.equal(result.playback.completedStallMs.total,100);
  assert.ok(!JSON.stringify(result).includes('private.mov'));
});

test('download produces JSON with a generic filename, then frees object URL', async () => {
  const diag=createPlaybackDiagnostics({});
  let blob, timeout, clicked=false, removed=false, revoked=false;
  const link={click(){ clicked=true; },remove(){ removed=true; }};
  downloadPlaybackDiagnostics(diag,{
    document:{createElement:()=>link,body:{append(el){assert.equal(el, link)}}},
    URL:{createObjectURL(value){blob=value;return 'blob:test'},revokeObjectURL(url){assert.equal(url,'blob:test');revoked=true}},
    setTimeout(fn){timeout=fn}
  });
  assert.equal(link.download,'spatial-playback-diagnostics.json');
  assert.equal(link.href,'blob:test');
  assert.equal(blob.type,'application/json');
  assert.equal(JSON.parse(await blob.text()).schemaVersion,1);
  assert.equal(clicked,true);
  assert.equal(removed,true);
  assert.equal(revoked,false);
  timeout();
  assert.equal(revoked,true);
});
