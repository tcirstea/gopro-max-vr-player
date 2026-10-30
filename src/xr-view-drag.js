import {multiplyMatrix3,viewRotationMatrix,inverseViewRotation} from './quaternion.js';

const DRAG_RADIANS_PER_METRE=2;
// Grab the panorama with the right controller, independently of head tracking.
// Sideways/upward displacement pans it; controller rotation includes roll.
export function createXRViewDrag(){
 let active=false,anchor=null;
 return {
  setActive(value){active=!!value;if(!active)anchor=null;},
  reset(){active=false;anchor=null;},
  rebase(){anchor=null;},
  update(center,headPose,controllerPose){
   if(!active)return center;
   if(!headPose||!controllerPose){anchor=null;return center;}
   anchor??={center:center.slice(),head:viewRotationMatrix(0,0,headPose),inverseHead:inverseViewRotation(headPose),rotation:viewRotationMatrix(0,0,controllerPose),position:[controllerPose[12],controllerPose[13],controllerPose[14]]};
   const delta=[controllerPose[12]-anchor.position[0],controllerPose[13]-anchor.position[1],controllerPose[14]-anchor.position[2]],m=anchor.inverseHead;
   // Pan in the view plane at grab time; moving the head alone cannot drag.
   const x=m[0]*delta[0]+m[3]*delta[1]+m[6]*delta[2];
   const y=m[1]*delta[0]+m[4]*delta[1]+m[7]*delta[2];
   const pan=viewRotationMatrix(x*DRAG_RADIANS_PER_METRE,-y*DRAG_RADIANS_PER_METRE);
   const worldPan=multiplyMatrix3(anchor.head,multiplyMatrix3(pan,anchor.inverseHead));
   const rotation=multiplyMatrix3(anchor.rotation,inverseViewRotation(controllerPose));
   return multiplyMatrix3(anchor.center,multiplyMatrix3(worldPan,rotation));
  }
 };
}
