// Scalar-first Hamilton quaternions; right-handed viewer axes X right, Y up,
// -Z forward. Matrices are column-major, suitable for WebGL/WebAudio.
export const IDENTITY_QUATERNION=Object.freeze([1,0,0,0]);
export function normalizeQuaternion(q){
 if(!q||q.length!==4||!q.every(Number.isFinite))throw new Error('Invalid orientation quaternion.');
 const norm=Math.hypot(...q);if(norm<1e-8)throw new Error('Zero orientation quaternion.');
 return Array.from(q,x=>x/norm);
}
export function multiplyQuaternion([a,b,c,d],[e,f,g,h]){return [a*e-b*f-c*g-d*h,a*f+b*e+c*h-d*g,a*g-b*h+c*e+d*f,a*h+b*g-c*f+d*e];}
export function conjugateQuaternion([w,x,y,z]){return [w,-x,-y,-z];}
export function quaternionMatrix(q){
 const [w,x,y,z]=normalizeQuaternion(q);
 return new Float32Array([1-2*(y*y+z*z),2*(x*y+w*z),2*(x*z-w*y),2*(x*y-w*z),1-2*(x*x+z*z),2*(y*z+w*x),2*(x*z+w*y),2*(y*z-w*x),1-2*(x*x+y*y)]);
}
export function multiplyMatrix3(a,b){return new Float32Array(Array.from({length:9},(_,i)=>{const row=i%3,col=Math.floor(i/3);return a[row]*b[col*3]+a[3+row]*b[col*3+1]+a[6+row]*b[col*3+2];}));}
export function viewRotationMatrix(yaw,pitch,pose=null){
 const y=quaternionMatrix([Math.cos(yaw/2),0,Math.sin(yaw/2),0]);
 const p=pose?new Float32Array([pose[0],pose[1],pose[2],pose[4],pose[5],pose[6],pose[8],pose[9],pose[10]]):quaternionMatrix([Math.cos(pitch/2),Math.sin(pitch/2),0,0]);
 return multiplyMatrix3(y,p);
}
