/**
 * First-order ACN/SN3D (W,Y,Z,X) to eight virtual-speaker HRTF headphones.
 * Only connect metadata-verified ambisonics, never ordinary quad/stereo audio.
 * AmbiX: +X front, +Y left, +Z up. Viewer/Web Audio: +x right,+y up,-z front.
 * Reference: https://github.com/google/spatial-media/blob/master/docs/spatial-audio-rfc.md
 * Web Audio graph semantics: https://www.w3.org/TR/webaudio/#PannerNode
 */
const IDENTITY=Object.freeze([1,0,0,0,1,0,0,0,1]);
// A basic SN3D cube decoder is (W + 3 r·[X,Y,Z])/8. First-order
// max-rE weighting (1/sqrt(3)) gives (W + sqrt(3) r·[X,Y,Z])/8.
// A further 1/4 gain leaves 12 dB of headroom: the sum of the absolute
// coefficients of all eight outputs is <=1 for four independently full-scale
// input channels. HRTF filter peaks still depend on the browser; this is not a limiter.
export const SPATIAL_HEADROOM=0.25;
export const VIRTUAL_SPEAKERS=Object.freeze([-1,1].flatMap(x=>[-1,1].flatMap(y=>[-1,1].map(z=>{
 const r=1/Math.sqrt(3),direction=Object.freeze([x*r,y*r,z*r]);
 return Object.freeze({direction,position:Object.freeze([-y*r,z*r,-x*r]),gains:Object.freeze([1,y,z,x].map(v=>v*SPATIAL_HEADROOM/8))});
}))));

/** Convert a column-major camera-to-source rotation to listener axes.
 * Includes view rotation and the same stabilization applied to panorama rays.
 * Translation is intentionally absent: the panorama is at infinity.
 */
export function listenerOrientation(rotation=IDENTITY){
 if(!rotation||rotation.length!==9||!Array.from(rotation).every(Number.isFinite))throw new Error('Audio view rotation must be a finite 3 × 3 rotation.');
 const columns=[0,3,6].map(i=>Array.from(rotation).slice(i,i+3));
 const dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);
 if(columns.some(c=>Math.abs(dot(c,c)-1)>.002)||Math.abs(dot(columns[0],columns[1]))>.002||Math.abs(dot(columns[0],columns[2]))>.002||Math.abs(dot(columns[1],columns[2]))>.002)throw new Error('Audio view rotation must be orthonormal.');
 const [a,b,c]=columns,det=a[0]*(b[1]*c[2]-b[2]*c[1])-b[0]*(a[1]*c[2]-a[2]*c[1])+c[0]*(a[1]*b[2]-a[2]*b[1]);
 if(det<.998)throw new Error('Audio view rotation must preserve handedness.');
 return {forward:columns[2].map(v=>v===0?0:-v),up:columns[1]};
}
function coordinates(node,kind,values,time){
 const names=kind==='position'?['positionX','positionY','positionZ']:kind==='forward'?['forwardX','forwardY','forwardZ']:['upX','upY','upZ'];
 if(names.every(name=>node[name]?.setValueAtTime)){names.forEach((name,i)=>node[name].setValueAtTime(values[i],time));return true;}
 return false;
}

/** The caller owns the AudioContext, its listener, destination and input sources.
 * close() disconnects our graph only; it does not close/suspend the context.
 */
export function createSpatialAudio(context,destination=context.destination){
 const nodes=[];let closed=false;
 const own=node=>{nodes.push(node);return node;};
 const disconnect=()=>{for(const node of nodes){try{node.disconnect();}catch{}}};
 try{
  // Explicit discrete input prevents Web Audio's speaker-layout downmix rules
  // from treating W,Y,Z,X as a conventional surround layout.
  const input=own(context.createGain());input.channelCount=4;input.channelCountMode='explicit';input.channelInterpretation='discrete';
  const splitter=own(context.createChannelSplitter(4));input.connect(splitter);
  for(const speaker of VIRTUAL_SPEAKERS){
   const panner=own(context.createPanner());panner.panningModel='HRTF';panner.distanceModel='inverse';panner.refDistance=1;panner.rolloffFactor=0;panner.coneInnerAngle=360;panner.coneOuterAngle=360;panner.coneOuterGain=1;panner.channelCount=1;panner.channelCountMode='explicit';panner.channelInterpretation='discrete';
   if(!coordinates(panner,'position',speaker.position,context.currentTime))panner.setPosition(...speaker.position);
   for(let channel=0;channel<4;channel++){
    const gain=own(context.createGain());gain.gain.value=speaker.gains[channel];gain.channelCount=1;gain.channelCountMode='explicit';gain.channelInterpretation='discrete';
    splitter.connect(gain,channel,0);gain.connect(panner);
   }
   panner.connect(destination);
  }
  const listener=context.listener;
  if(!coordinates(listener,'position',[0,0,0],context.currentTime))listener.setPosition(0,0,0);
  function setViewRotation(rotation){
   if(closed)return;
   const {forward,up}=listenerOrientation(rotation),now=context.currentTime;
   if(listener.forwardX?.setValueAtTime&&listener.upX?.setValueAtTime){coordinates(listener,'forward',forward,now);coordinates(listener,'up',up,now);}
   else listener.setOrientation(...forward,...up);
  }
  setViewRotation(IDENTITY);
  return {input,setViewRotation,close(){if(closed)return;closed=true;disconnect();}};
 }catch(error){disconnect();throw error;}
}
