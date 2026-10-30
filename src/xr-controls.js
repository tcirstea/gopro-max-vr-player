// Quest Touch xr-standard mapping: stick axes 2/3; grip 1; stick click 3;
// A/X 4 toggles playback, B/Y 5 toggles the panel. Upper triggers select items in the VR panel.
export {DEFAULT_FOV,zoomFov} from './zoom.js';
export function createXRControls({zoom, seek, togglePlayback, resetZoom=()=>{},dragView=()=>{},togglePanel=()=>{},zoomEnd=()=>{}}) {
  const states=new Map();let gripOwner=null,stickOwner=null,direction=0,repeatAt=0,zoomGesture=null;
  function endGrip(){if(gripOwner){const previous=gripOwner;gripOwner=null;dragView(false,previous);}}
  function reset(){endGrip();states.clear();stickOwner=null;direction=0;repeatAt=0;if(zoomGesture)zoomEnd();zoomGesture=null;}
  return {reset, update(session,time){
    if(session.visibilityState && session.visibilityState!=='visible'){reset();return;}
    // Right wins simultaneous new input, but a held grip always retains its owner.
    const sources=Array.from(session.inputSources||[]).filter(s=>['right','left'].includes(s.handedness) && !s.hand && s.gamepad?.mapping==='xr-standard' && s.gamepad.connected!==false).sort((a,b)=>(a.handedness==='right'?0:1)-(b.handedness==='right'?0:1));
    if(!sources.length){reset();return;}
    for(const source of states.keys())if(!sources.includes(source))states.delete(source);
    if(gripOwner && (!states.has(gripOwner)||!gripOwner.gamepad.buttons?.[1]?.pressed))endGrip();
    let play=false,resetClicked=false,panelSource=null;
    const samples=sources.map(source=>{
      const pad=source.gamepad,buttons=[1,3,4,5].map(i=>!!pad.buttons?.[i]?.pressed),previous=states.get(source);
      const rising=i=>!!previous && buttons[i]&&!previous.buttons[i];
      if(rising(0)&&!gripOwner){gripOwner=source;dragView(true,source);}
      if(rising(1))resetClicked=true;
      if(rising(2))play=true;
      if(rising(3)&&!panelSource)panelSource=source;
      const axis=i=>Number.isFinite(pad.axes?.[i])?Math.max(-1,Math.min(1,pad.axes[i])):0;
      const dt=previous?Math.max(0,Math.min(.05,(time-previous.time)/1000)):0;
      states.set(source,{buttons,time});
      return {source,x:axis(2),y:axis(3),clicked:buttons[1],dt};
    });
    // Full release means both axes of the zooming controller are neutral.
    // Horizontal deflection or stick clicking alone does not clear a detent.
    const gestureSample=samples.find(s=>s.source===zoomGesture);
    if(zoomGesture&&(!gestureSample||(Math.abs(gestureSample.x)<=.2&&Math.abs(gestureSample.y)<=.2))){zoomEnd();zoomGesture=null;}
    if(resetClicked)resetZoom();
    const sample=samples.find(s=>!s.clicked&&(Math.abs(s.x)>.2||Math.abs(s.y)>.2));
    if(sample?.source!==stickOwner){stickOwner=sample?.source||null;direction=0;repeatAt=0;}
    let nextDirection=0;
    if(sample&&!resetClicked){
      const {x,y,dt}=sample;
      const vertical=Math.abs(y)>.2 && Math.abs(y)>=Math.abs(x);
      if(vertical){
        if(zoomGesture&&zoomGesture!==sample.source)zoomEnd();
        zoomGesture=sample.source;zoom(Math.sign(y)*(Math.abs(y)-.2)/.8*600*dt,time);
      }
      nextDirection=!vertical && Math.abs(x)>.55?Math.sign(x):0;
      if(nextDirection&&(nextDirection!==direction||time>=repeatAt)){seek(nextDirection*5);repeatAt=time+500;}
    }
    direction=nextDirection;
    if(play)togglePlayback();
    if(panelSource)togglePanel(panelSource);
  }};
}
