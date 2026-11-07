// Transport shortcuts are separate from renderer view controls. Native form and
// button behavior wins, including Space activation of the focused Play button.
const interactive = 'input,textarea,select,button,a[href],summary,[contenteditable]:not([contenteditable="false"]),[role="button"],[role="slider"],[role="textbox"],[role="combobox"],[role="listbox"],[role="menu"],dialog,[role="dialog"]';
function protectedTarget(target) {
  return !!(target?.isContentEditable || target?.closest?.(interactive));
}
export function installKeyboardControls({target,document:doc,togglePlayback,seek,revealControls,canPlay,canSeek,setInterval:repeat=globalThis.setInterval,clearInterval:cancel=globalThis.clearInterval}) {
  let heldSpace=false,arrow=null,timer=null;
  const blocked=event=>doc.hidden || !!doc.querySelector?.('dialog[open], [role="dialog"][aria-modal="true"]') ||
    protectedTarget(doc.activeElement) || (event?.composedPath?.() || [event?.target]).some(protectedTarget);
  function stopArrow(){if(timer!==null)cancel(timer);timer=null;arrow=null;}
  function reset(){heldSpace=false;stopArrow();}
  function step(){
    if(blocked() || !canSeek()){stopArrow();return;}
    revealControls();seek(arrow==='ArrowLeft'?-5:5);
  }
  function keydown(event){
    if(event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || blocked(event)){reset();return;}
    if(event.key===' ' || event.key==='Spacebar'){
      if(!canPlay())return;
      event.preventDefault();
      if(event.repeat || heldSpace)return;
      heldSpace=true;revealControls();togglePlayback();
    }else if(event.key==='ArrowLeft' || event.key==='ArrowRight'){
      if(!canSeek())return;
      event.preventDefault();
      if(event.repeat || arrow===event.key)return;
      stopArrow();arrow=event.key;step();
      if(arrow!==null)timer=repeat(step,500);
    }
  }
  function keyup(event){
    if(event.key===' ' || event.key==='Spacebar'){
      if(heldSpace)event.preventDefault();heldSpace=false;
    }
    if(event.key===arrow)stopArrow();
  }
  target.addEventListener('keydown',keydown);
  target.addEventListener('keyup',keyup);
  target.addEventListener('blur',reset);
  target.addEventListener('pagehide',reset);
  target.addEventListener('focusin',reset);
  doc.addEventListener?.('visibilitychange',reset);
  return ()=>{
    reset();
    for(const [name,handler] of [['keydown',keydown],['keyup',keyup],['blur',reset],['pagehide',reset],['focusin',reset]])target.removeEventListener(name,handler);
    doc.removeEventListener?.('visibilitychange',reset);
  };
}
