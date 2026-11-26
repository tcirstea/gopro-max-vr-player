// Normalized 8-bit Y'CbCr to display R'G'B'. This is not HDR tone mapping.
// Match FFmpeg's default 709 matrix for files without matrix metadata.
export function yuvColor(flags) {
  const [kr,kb] = (flags & 3) === 1 ? [.299,.114] : (flags & 3) === 2 ? [.2627,.0593] : [.2126,.0722];
  const kg = 1-kr-kb, full = !!(flags & 4), chroma = full ? 1 : 255/224;
  return {
    levels:[full ? 0 : 16/255, full ? 1 : 255/219, 128/255],
    coeff:[2*(1-kr)*chroma, -2*kb*(1-kb)/kg*chroma, -2*kr*(1-kr)/kg*chroma, 2*(1-kb)*chroma]
  };
}

export function yuvLayout(width,height) {
  const cw=Math.ceil(width/2), ch=Math.ceil(height/2), y=width*height, c=cw*ch;
  // Match the guarded plane layout of the WASM bridge.
  return {planes:[[0,y,width,height],[y+64,c,cw,ch],[y+c+128,c,cw,ch]], bytes:y+2*c+128};
}

export const YUV_GLSL=`
uniform sampler2D spatialY,spatialU,spatialV;
uniform float planarVideo;
uniform vec3 yuvLevels;
uniform vec4 yuvCoeff;
vec4 samplePlaneVideo(vec2 point) {
  vec2 st=vec2(point.x,1.-point.y); // typed bytes are uploaded in top-down row order
  float y=(texture2D(spatialY,st).r-yuvLevels.x)*yuvLevels.y;
  float u=texture2D(spatialU,st).r-yuvLevels.z;
  float v=texture2D(spatialV,st).r-yuvLevels.z;
  return vec4(y+yuvCoeff.x*v,y+yuvCoeff.y*u+yuvCoeff.z*v,y+yuvCoeff.w*u,1.);
}
`;
