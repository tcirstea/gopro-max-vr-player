import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createXRViewDrag} from '../src/xr-view-drag.js';
import {quaternionMatrix,multiplyMatrix3,viewRotationMatrix,inverseViewRotation} from '../src/quaternion.js';
const near=(a,b)=>Array.from(a).forEach((v,i)=>assert.ok(Math.abs(v-b[i])<1e-6,`${i}: ${v} != ${b[i]}`));
const identity=quaternionMatrix([1,0,0,0]);
const pose=(q=[1,0,0,0],position=[0,0,0])=>{const r=quaternionMatrix(q);return [r[0],r[1],r[2],0,r[3],r[4],r[5],0,r[6],r[7],r[8],0,...position,1];};
test('controller grab has no press/release snap, preserves prior offset, and head alone cannot drag',()=>{
 const drag=createXRViewDrag(),head=pose([.5,.5,.5,.5]),hand=pose([.7,-.2,.3,.1]);let center=quaternionMatrix([.8,.2,-.1,.3]);const original=center.slice();
 drag.setActive(true);center=drag.update(center,head,hand);near(center,original);
 center=drag.update(center,pose([.3,.1,.7,-.2],[5,6,7]),hand);near(center,original);
 const moved=pose([.7,-.2,.3,.1],[.1,.2,0]);center=drag.update(center,head,moved);const released=center.slice();assert.notDeepEqual(Array.from(center),Array.from(original));
 drag.setActive(false);near(drag.update(center,head,moved),released);near(drag.update(center,pose(),pose()),released);
 drag.setActive(true);near(drag.update(center,pose(),pose()),released);
});
test('controller translation pans horizontally/vertically in grab-time view plane and ignores depth',()=>{
 const check=(position,expected,head=pose())=>{const drag=createXRViewDrag();drag.setActive(true);drag.update(identity,head,pose());near(drag.update(identity,head,pose([1,0,0,0],position)),expected);};
 check([.2,0,0],viewRotationMatrix(.4,0));check([0,.3,0],viewRotationMatrix(0,-.6));check([0,0,5],identity);
 // Looking right at grab time: world Z movement is now horizontal in the view plane.
 const head=pose([Math.SQRT1_2,0,Math.SQRT1_2,0]);check([0,0,-.2],viewRotationMatrix(.4,0),head);check([5,0,0],identity,head);
});
test('controller rotation applies inverse yaw/pitch/roll delta without overwriting prior correction',()=>{
 const initial=pose([.5,.5,.5,.5]),head=pose(),center=quaternionMatrix([.8,.1,.3,.2]);
 for(const q of [[Math.cos(.2),Math.sin(.2),0,0],[Math.cos(.2),0,Math.sin(.2),0],[Math.cos(.2),0,0,Math.sin(.2)]]){
  const drag=createXRViewDrag();drag.setActive(true);drag.update(center,head,initial);
  const delta=quaternionMatrix(q),r=multiplyMatrix3(delta,viewRotationMatrix(0,0,initial));const moved=[r[0],r[1],r[2],0,r[3],r[4],r[5],0,r[6],r[7],r[8],0,0,0,0,1];
  near(drag.update(center,head,moved),multiplyMatrix3(center,inverseViewRotation(pose(q))));
 }
});
test('tracking loss rebases at retained correction; recenter while held establishes a fresh controller anchor',()=>{
 const drag=createXRViewDrag(),head=pose([.5,.5,.5,.5]);drag.setActive(true);drag.update(identity,head,pose());let center=drag.update(identity,head,pose([1,0,0,0],[.1,.2,0]));
 const retained=center.slice();near(drag.update(center,head,null),retained);const reacquired=pose([.8,.3,.1,-.4],[3,4,5]);center=drag.update(center,head,reacquired);near(center,retained);
 center=inverseViewRotation(head);drag.rebase();near(drag.update(center,head,reacquired),center);near(multiplyMatrix3(center,viewRotationMatrix(0,0,head)),identity);
 drag.update(center,null,reacquired);near(drag.update(center,head,pose()),center);drag.reset();near(drag.update(center,head,reacquired),center);
});
