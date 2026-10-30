// Quest Touch uses xr-standard stick axes 2/3 and A at button 4.
// Keep triggers free for future navigation; never inspect non-XR gamepads.
export const DEFAULT_FOV = Math.PI / 2;
export function zoomFov(fov, wheelDelta) {
  return Math.max(.4, Math.min(2.1, fov + wheelDelta * .001));
}
export function createXRControls({zoom, seek, togglePlayback}) {
  let source=null, lastTime=null, pressed=false, direction=0, repeatAt=0;
  function reset(){source=null;lastTime=null;pressed=false;direction=0;repeatAt=0;}
  return {reset, update(session,time){
    if(session.visibilityState && session.visibilityState!=='visible'){reset();return;}
    const next=Array.from(session.inputSources||[]).find(s=>s.handedness==='right' && !s.hand && s.gamepad?.mapping==='xr-standard' && s.gamepad.connected!==false);
    if(!next){reset();return;}
    const pad=next.gamepad;
    if(next!==source){reset();source=next;pressed=!!pad.buttons?.[4]?.pressed;}
    const dt=lastTime===null?0:Math.max(0,Math.min(.05,(time-lastTime)/1000));lastTime=time;
    const axis=i=>Number.isFinite(pad.axes?.[i])?Math.max(-1,Math.min(1,pad.axes[i])):0;
    const x=axis(2),y=axis(3);
    // Dominant-axis lock prevents a small diagonal wobble from seeking while zooming.
    const vertical=Math.abs(y)>.2 && Math.abs(y)>=Math.abs(x);
    if(vertical)zoom(Math.sign(y)*(Math.abs(y)-.2)/.8*600*dt);
    const nextDirection=!vertical && Math.abs(x)>.55?Math.sign(x):0;
    if(nextDirection && (nextDirection!==direction || time>=repeatAt)){
      seek(nextDirection*5);repeatAt=time+500;
    }
    direction=nextDirection;
    const down=!!pad.buttons?.[4]?.pressed;
    if(down&&!pressed)togglePlayback();
    pressed=down;
  }};
}
