// Reuse the live browser controls, rather than maintaining a second transport.
// This controller never sends playback, renderer, or immersive-panel actions.
export function installDesktopFullscreenControls({document:doc,window:win,setTimeout:later=globalThis.setTimeout,clearTimeout:cancel=globalThis.clearTimeout}) {
  const byId=id=>doc.getElementById(id),viewer=byId('viewer'),canvas=byId('canvas'),dock=byId('fullscreen-controls');
  const actions=viewer?.querySelector?.('.viewer-bottom'),transport=byId('playback-controls'),playlist=byId('playlist'),dialog=byId('playlist-window'),button=byId('fullscreen');
  // The page may be missing its viewer (for example, during embedding/teardown).
  if(!viewer||!canvas||!dock||!actions||!transport)return {reveal(){},hide(){},dispose(){}};
  let active=false,disposed=false,timer=null,keyboardFocus=false,keyboardMode=false,pointerFocus=null,blurred=false,moving=false;
  const held=new Set(),listeners=[],homes=[];
  function listen(target,name,handler,options){target?.addEventListener(name,handler,options);listeners.push(()=>target?.removeEventListener(name,handler,options));}
  const inControls=node=>!!node&&(dock.contains(node)||dialog?.contains(node));
  const pinned=()=>held.size>0||dialog?.open||(keyboardFocus&&inControls(doc.activeElement));
  function clearTimer(){if(timer!==null)cancel(timer);timer=null;}
  function arm(){clearTimer();if(active&&!doc.hidden&&!blurred&&!pinned())timer=later(hide,2000);}
  function reveal(){
    if(!active||disposed)return;
    viewer.classList.remove('controls-hidden','fullscreen-controls-hidden');arm();
  }
  function hide(){
    clearTimer();if(!active||disposed||pinned())return;
    pointerFocus=null;
    // Mouse-click focus must not keep the dock open forever, nor be left on an
    // invisible control. Tab/assistive focus is kept visible until it leaves.
    if(dock.contains(doc.activeElement)){moving=true;canvas.focus({preventScroll:true});moving=false;}
    viewer.classList.add('fullscreen-controls-hidden');
  }
  function closeForMove(node){
    // Removing an open modal from the DOM drops its top-layer membership but
    // leaves .open true. Close first so Browse playlist can showModal again.
    if(node===dialog&&dialog.open)dialog.close();
  }
  function rememberAndMove(node,parent){
    if(!node)return;closeForMove(node);
    const marker=doc.createComment('fullscreen controls position');node.before(marker);homes.push({node,marker});parent.append(node);
  }
  function restore(){for(const {node,marker} of homes){closeForMove(node);marker.replaceWith(node);}homes.length=0;}
  function sync(){
    if(disposed)return;
    const fullscreen=doc.fullscreenElement===viewer;
    button.textContent=fullscreen?'Exit full screen':'Full screen';
    button.setAttribute('aria-pressed',String(fullscreen));
    const next=fullscreen;
    if(next===active)return;
    clearTimer();held.clear();keyboardFocus=false;pointerFocus=null;
    const focused=doc.activeElement,retainFocus=inControls(focused)||actions.contains(focused)||focused===button;moving=true;active=next;
    if(active){
      rememberAndMove(actions,dock);rememberAndMove(transport,dock);rememberAndMove(playlist,dock);
      // Keep the modal inside the fullscreen subtree, but outside the idle dock.
      rememberAndMove(dialog,viewer);
      viewer.classList.add('desktop-fullscreen');viewer.classList.remove('controls-hidden','fullscreen-controls-hidden');
    }else{
      viewer.classList.remove('desktop-fullscreen','fullscreen-controls-hidden','controls-hidden');restore();
    }
    // Reparenting can reset focus in browsers. Preserve focus, especially when
    // entering/exiting with the keyboard; Escape still belongs to the browser.
    if(retainFocus){
      const target=dialog?.contains(focused)&&!dialog.open?(byId('open-playlist')||button):focused;
      target?.focus?.({preventScroll:true});
    }
    moving=false;keyboardFocus=keyboardMode&&inControls(doc.activeElement);arm();
  }
  function nearDock(event){
    const r=dock.getBoundingClientRect(),v=viewer.getBoundingClientRect();
    return event.clientX>=v.left&&event.clientX<=v.right&&event.clientY>=v.top&&event.clientY<=v.bottom&&
      event.clientX>=r.left-48&&event.clientX<=r.right+48&&event.clientY>=r.top-48;
  }
  function pointerMove(event){
    if(!active)return;
    if(held.has(event.pointerId)&&event.buttons===0){held.delete(event.pointerId);arm();}
    if(!viewer.classList.contains('fullscreen-controls-hidden')||nearDock(event))reveal();
  }
  function pointerDown(event){
    keyboardMode=false;if(!active)return;
    keyboardFocus=false;pointerFocus=event.target;
    if(inControls(event.target))held.add(event.pointerId);
    reveal();
  }
  function pointerEnd(event){
    if(!active)return;
    held.delete(event.pointerId);arm();
  }
  function keydown(event){
    if(event.isComposing||event.key==='Escape'||event.altKey||event.ctrlKey||event.metaKey)return;
    keyboardMode=true;if(!active)return;
    pointerFocus=null;keyboardFocus=inControls(doc.activeElement);reveal();
  }
  function focusIn(event){
    if(!active||moving)return;
    // Label activation and clicks on button children focus another element,
    // sometimes only after pointerup. They are still pointer interactions.
    keyboardFocus=inControls(event.target)&&(keyboardMode||pointerFocus===null);
    if(!inControls(event.target))pointerFocus=null;
    reveal();
  }
  function focusOut(event){
    if(!active||moving)return;
    if(!inControls(event.relatedTarget)){keyboardFocus=false;arm();}
  }
  function suspend(){blurred=true;held.clear();pointerFocus=null;clearTimer();}
  function resume(){blurred=false;reveal();}
  listen(doc,'fullscreenchange',sync);
  listen(viewer,'pointermove',pointerMove);
  listen(viewer,'pointerdown',pointerDown,true);
  for(const name of ['pointerup','pointercancel','lostpointercapture'])listen(win,name,pointerEnd,true);
  listen(viewer,'pointerleave',()=>{pointerFocus=null;arm();});
  listen(doc,'keydown',keydown,true);
  listen(viewer,'focusin',focusIn);
  listen(viewer,'focusout',focusOut);
  for(const name of ['input','change','click'])listen(dock,name,reveal);
  listen(dialog,'close',()=>{held.clear();reveal();});
  listen(win,'blur',suspend);listen(win,'focus',resume);
  listen(doc,'visibilitychange',()=>{if(doc.hidden)suspend();else resume();});
  function dispose(){
    if(disposed)return;clearTimer();held.clear();active=false;disposed=true;
    viewer.classList.remove('desktop-fullscreen','fullscreen-controls-hidden','controls-hidden');restore();
    for(const remove of listeners)remove();
  }
  listen(win,'pagehide',event=>{if(event.persisted)suspend();else dispose();});
  listen(win,'pageshow',event=>{if(event.persisted){sync();resume();}});sync();
  return {reveal,hide,dispose};
}
