export const DEFAULT_FOV=Math.PI/2;
export const MIN_FOV=.15,MAX_FOV=2.8;
export const ZOOM_DETENTS=Object.freeze([.4,DEFAULT_FOV,2.1]);
export const DETENT_MILLISECONDS=500;
export function zoomFov(fov,wheelDelta){
 if(!Number.isFinite(wheelDelta))return fov;
 return Math.max(MIN_FOV,Math.min(MAX_FOV,fov+wheelDelta*.001));
}
// Discard overshoot at a stop: no delayed movement after input has ended.
// Strict crossing excludes the current stop, so continuing after a pause or
// release cannot immediately retrigger it and trap the user there.
export function createZoomDetents(){
 let stop=null;
 return {
  release(){stop=null;},
  reset(){stop=null;},
  apply(fov,delta,time){
   if(!Number.isFinite(delta)||delta===0)return fov;
   const direction=Math.sign(delta),now=Number.isFinite(time)?time:0;
   if(stop){
    if(Math.abs(fov-stop.value)>1e-10||direction!==stop.direction||now>=stop.until)stop=null;
    else return fov;
   }
   const target=zoomFov(fov,delta);
   const crossed=ZOOM_DETENTS.filter(value=>direction>0?value>fov+1e-10&&value<=target:value<fov-1e-10&&value>=target);
   if(crossed.length){
    const value=direction>0?crossed[0]:crossed.at(-1);
    stop={value,direction,until:now+DETENT_MILLISECONDS};return value;
   }
   return target;
  }
 };
}
