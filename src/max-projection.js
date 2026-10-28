/** Original MAX EAC mapping adapted from trek-view/max2sphere (Apache-2.0).
 * See THIRD_PARTY_NOTICES.md. Coordinates returned here have a bottom-left origin.
 */
export const MAX_LAYOUTS = Object.freeze([
  Object.freeze({width:4096,height:1344,side:1376,center:1344,blend:32}),
  Object.freeze({width:2272,height:736,side:768,center:736,blend:16}),
]);
export function maxLayout(width,height) {
  const layout=MAX_LAYOUTS.find(x=>x.width===width&&x.height===height);
  if(!layout) throw new Error(`Unsupported original MAX layout: ${width} × ${height}. Expected 4096 × 1344 or 2272 × 736 per track.`);
  return layout;
}
export function maxCoordinates([x,y,z],layout=MAX_LAYOUTS[0]) {
  // Viewer coordinates: x right, y up, -z front. Bourke: x right,y front,z up.
  const a=x,b=-z,c=y, m=Math.max(Math.abs(a),Math.abs(b),Math.abs(c));
  if(!Number.isFinite(m)||m===0) throw new Error('Direction must be finite and nonzero.');
  const e=n=>Math.atan(n/m)*4/Math.PI;
  let face,u,v;
  if(Math.abs(a)===m){face=a<0?'left':'right';u=(1+(a<0?e(b):-e(b)))/2;v=(1+e(c))/2;}
  else if(Math.abs(b)===m){face=b>0?'front':'back';u=(1+(b>0?e(a):-e(a)))/2;v=(1+e(c))/2;}
  else {face=c>0?'top':'down';u=(1-e(a))/2;v=(1+(c>0?e(b):-e(b)))/2;}
  const track=['back','down','top'].includes(face)?1:0;
  if(track)[u,v]=[v,1-u];
  const {width,height,side,center,blend}=layout;
  let x1,x2,alpha=0;
  if(face==='front'||face==='back')x1=x2=side+u*center;
  else {const start=face==='right'||face==='top'?side+center:0;const q=blend/side;const l=(1-2*q)*u;const r=l+2*q; x1=start+l*side;x2=start+r*side;alpha=Math.max(0,Math.min(1,(l-.5+2*q)/(2*q)));}
  const clampX=n=>Math.max(.5,Math.min(width-.5,n))/width;
  return {face,track,uv1:[clampX(x1),Math.max(.5,Math.min(height-.5,v*height))/height],uv2:[clampX(x2),Math.max(.5,Math.min(height-.5,v*height))/height],alpha};
}
export const MAX_GLSL = `
// Mapping and overlap math adapted from trek-view/max2sphere, Apache-2.0.
uniform sampler2D trackOne; uniform vec4 maxSize; uniform float maxBlend;
vec4 maxTex(float track,vec2 p){p=clamp(p,vec2(.5),maxSize.xy-vec2(.5))/maxSize.xy;return track<.5?texture2D(panorama,p):texture2D(trackOne,p);}
vec4 sampleMax(vec3 d){
 vec3 p=vec3(d.x,-d.z,d.y);vec3 a=abs(p);float m=max(a.x,max(a.y,a.z));vec3 e=atan(p/m)*1.273239544735;
 vec2 t;float face;float track=0.;
 if(a.x>=a.y&&a.x>=a.z){face=p.x<0.?0.:2.;t=vec2(p.x<0.?e.y:-e.y,e.z)*.5+.5;}
 else if(a.y>=a.z){face=1.;track=p.y>0.?0.:1.;t=vec2(p.y>0.?e.x:-e.x,e.z)*.5+.5;}
 else {track=1.;face=p.z>0.?2.:0.;t=vec2(-e.x,p.z>0.?e.y:-e.y)*.5+.5;}
 if(track>.5)t=vec2(t.y,1.-t.x);
 float side=maxSize.z;float center=maxSize.w;
 if(face==1.)return maxTex(track,vec2(side+t.x*center,t.y*maxSize.y));
 float offset=face==2.?side+center:0.;float q=maxBlend/side;float l=(1.-2.*q)*t.x;float r=l+2.*q;
 float alpha=clamp((l-.5+2.*q)/(2.*q),0.,1.);
 return mix(maxTex(track,vec2(offset+l*side,t.y*maxSize.y)),maxTex(track,vec2(offset+r*side,t.y*maxSize.y)),alpha);
}`;
