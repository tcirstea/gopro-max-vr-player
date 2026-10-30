import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createZoomDetents,zoomFov,DEFAULT_FOV,MIN_FOV,MAX_FOV,ZOOM_DETENTS} from '../src/zoom.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
test('zoom expands old bounds while preserving delta sensitivity',()=>{
 assert.equal(zoomFov(1,-100000),MIN_FOV);assert.equal(zoomFov(1,100000),MAX_FOV);
 near(zoomFov(1,12),1.012);assert.equal(zoomFov(1,NaN),1);
});
test('each detent stops crossing both directions for 500ms and never traps continued input',()=>{
 for(const marker of ZOOM_DETENTS)for(const sign of [-1,1]){
  const zoom=createZoomDetents();let fov=marker-sign*.05;
  fov=zoom.apply(fov,sign*100,1000);assert.equal(fov,marker);
  for(const time of [1001,1100,1499])assert.equal(zoom.apply(fov,sign*30,time),marker);
  fov=zoom.apply(fov,sign*30,1500);near(fov,marker+sign*.03);
  fov=zoom.apply(fov,sign*30,1510);near(fov,marker+sign*.06);
 }
});
test('full release or reversal moves immediately; later recrossing detents still stops',()=>{
 const zoom=createZoomDetents();let fov=zoom.apply(.5,-200,0);assert.equal(fov,.4);
 zoom.release();fov=zoom.apply(fov,-50,1);near(fov,.35);
 fov=zoom.apply(fov,100,2);assert.equal(fov,.4);
 fov=zoom.apply(fov,-30,3);near(fov,.37);
 fov=zoom.apply(fov,100,4);assert.equal(fov,.4);
});
test('oversized deltas stop at the first marker and release does not apply residual movement',()=>{
 const zoom=createZoomDetents();let fov=zoom.apply(MIN_FOV,100000,0);assert.equal(fov,.4);
 zoom.release();fov=zoom.apply(fov,0,5);assert.equal(fov,.4);
 fov=zoom.apply(fov,100000,10);assert.equal(fov,DEFAULT_FOV);
 fov=zoom.apply(fov,100000,510);assert.equal(fov,2.1);
 fov=zoom.apply(fov,100000,1010);assert.equal(fov,MAX_FOV);
});
test('explicit zoom reset clears pending stop and default is not re-triggered at rest',()=>{
 const zoom=createZoomDetents();assert.equal(zoom.apply(.5,-200,0),.4);
 zoom.reset();near(zoom.apply(DEFAULT_FOV,10,1),DEFAULT_FOV+.01);
 assert.equal(zoom.apply(DEFAULT_FOV,NaN,2),DEFAULT_FOV);
});
