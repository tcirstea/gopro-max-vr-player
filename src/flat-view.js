// A single world-space screen shared by both eyes. Never center per eye or
// rewrite the XR camera matrices: physical head translation/rotation stays live.
export const DEFAULT_FLAT_DISTANCE=2;
export const MIN_FLAT_DISTANCE=.6,MAX_FLAT_DISTANCE=8;
export function flatSize(aspect){
 const ratio=Number.isFinite(aspect)&&aspect>0?aspect:16/9;
 const width=Math.min(3.2,2.4*ratio);
 return [width,width/ratio];
}
export function zoomFlatDistance(distance,delta){
 return Number.isFinite(delta)?Math.max(MIN_FLAT_DISTANCE,Math.min(MAX_FLAT_DISTANCE,distance*Math.exp(delta*.001))):distance;
}
export function createFlatView(){
 let distance=DEFAULT_FLAT_DISTANCE,anchor=null;
 return {
  get distance(){return distance;},
  zoom(delta){distance=zoomFlatDistance(distance,delta);},
  reset(){distance=DEFAULT_FLAT_DISTANCE;anchor=null;},
  recenter(){anchor=null;},
  update(pose){if(!anchor&&pose)anchor=Array.from(pose);},
  get placement(){
   const a=anchor||[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
   return {center:[a[12]-a[8]*distance,a[13]-a[9]*distance,a[14]-a[10]*distance],
    // Inverse of the rigid screen orientation, column major.
    rotation:[a[0],a[4],a[8],a[1],a[5],a[9],a[2],a[6],a[10]]};
  }
 };
}
export const FLAT_GLSL=`
 uniform float videoAspect,flatDistance;
 uniform vec3 flatCenter;
 uniform mat3 flatRotation;
 uniform vec2 flatSize;
 vec4 sampleFlat(){
  vec2 point;
  if(xr>.5){
   vec3 ray=flatRotation*mat3(viewRotation)*(invProjection*vec4(uv,-1.,1.)).xyz;
   vec3 origin=flatRotation*(viewRotation[3].xyz-flatCenter);
   if(ray.z>=-.00001)return vec4(0.,0.,0.,1.);
   float t=-origin.z/ray.z;
   if(t<=0.)return vec4(0.,0.,0.,1.);
   point=(origin.xy+t*ray.xy)/flatSize+.5;
  }else{
   vec2 fit=vec2(min(1.,videoAspect/aspect),min(1.,aspect/videoAspect));
   point=uv/(fit*(2./flatDistance))*.5+.5;
  }
  if(any(lessThan(point,vec2(0.)))||any(greaterThan(point,vec2(1.))))return vec4(0.,0.,0.,1.);
  return texture2D(panorama,point);
 }
`;
