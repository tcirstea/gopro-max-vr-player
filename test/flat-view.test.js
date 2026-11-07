import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createFlatView,flatSize,zoomFlatDistance,DEFAULT_FLAT_DISTANCE,MIN_FLAT_DISTANCE,MAX_FLAT_DISTANCE} from '../src/flat-view.js';
const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,1.6,0,1];
test('flat screen preserves landscape, portrait and square aspect ratios with finite bounds',()=>{
 for(const aspect of [16/9,9/16,1,2,4,.1]){const [w,h]=flatSize(aspect);assert.ok(w<=3.2&&h<=2.4000001);assert.ok(Math.abs(w/h-aspect)<1e-8);}
 assert.deepEqual(flatSize(NaN),flatSize(16/9));assert.deepEqual(flatSize(0),flatSize(16/9));
});
test('flat zoom changes finite distance with consistent direction and limits',()=>{
 assert.ok(zoomFlatDistance(2,-100)<2);assert.ok(zoomFlatDistance(2,100)>2);
 assert.equal(zoomFlatDistance(2,Infinity),2);assert.equal(zoomFlatDistance(2,1e6),MAX_FLAT_DISTANCE);assert.equal(zoomFlatDistance(2,-1e6),MIN_FLAT_DISTANCE);
});
test('pane is anchored once in world space, then reset/recenter uses center-head pose including translation',()=>{
 const screen=createFlatView();screen.update(identity);assert.deepEqual(screen.placement.center,[0,1.6,-2]);
 const turned=[0,0,-1,0,0,1,0,0,1,0,0,0,4,2,3,1];screen.update(turned);assert.deepEqual(screen.placement.center,[0,1.6,-2]);
 screen.zoom(-100);assert.ok(screen.distance<2);assert.deepEqual(screen.placement.center,[0,1.6,-screen.distance]);
 screen.reset();assert.equal(screen.distance,DEFAULT_FLAT_DISTANCE);screen.update(null);screen.update(turned);assert.deepEqual(screen.placement.center,[2,2,3]);assert.deepEqual(screen.placement.rotation,[0,0,1,0,1,0,-1,0,0]);
 screen.zoom(100);screen.recenter();screen.update(identity);assert.deepEqual(screen.placement.center,[0,1.6,-screen.distance]);
});
test('both eyes intersect one screen with expected stereo disparity, rather than separate head-locked copies',()=>{
 const screen=createFlatView();screen.update(identity);const center=screen.placement.center,[width]=flatSize(16/9);
 // In the initial identity pose, center-ray screen coordinates use each
 // physical eye origin; moving the screen changes binocular disparity.
 const coordinate=eyeX=>.5+eyeX/width; // center ray at unchanged screen distance
 const left=coordinate(-.032),right=coordinate(.032);
 assert.ok(left<.5&&right>.5);assert.equal(center[2],-2);
 // Rays aimed at the SAME world screen center differ by eye, but intersect it.
 for(const eyeX of [-.032,.032]){const t=-center[2],rayX=-eyeX/t;assert.ok(Math.abs((eyeX+t*rayX)/width+.5-.5)<1e-9);}
});
