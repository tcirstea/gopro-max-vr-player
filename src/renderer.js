import {createXRPanel} from './xr-panel.js';
import {createZoomDetents} from './zoom.js';
import {createXRViewDrag} from './xr-view-drag.js';
import {createXRControls} from './xr-controls.js';
import {maxLayout,MAX_GLSL} from './max-projection.js';
import {IDENTITY_QUATERNION,quaternionMatrix,multiplyMatrix3,viewRotationMatrix,inverseViewRotation} from './quaternion.js';
export function createRenderer(canvas) {
  const gl=canvas.getContext('webgl',{alpha:false,antialias:false,xrCompatible:true});
  if(!gl)throw new Error('WebGL is unavailable. Enable hardware acceleration.');
  const vertex='attribute vec2 p; varying vec2 uv; void main(){uv=p;gl_Position=vec4(p,0.,1.);}';
  const fragment=`precision highp float; varying vec2 uv; uniform sampler2D panorama; uniform float aspect,yaw,pitch,roll,fov,mode,xr;uniform mat4 invProjection,viewRotation;uniform mat3 stabilization,xrCenter;
  ${MAX_GLSL}
  void main(){vec3 d;
  if(xr>.5){vec3 eyeRay=(invProjection*vec4(uv,-1.,1.)).xyz;eyeRay.xy*=tan(fov/2.);d=normalize(xrCenter*mat3(viewRotation)*eyeRay);}
  else {d=normalize(vec3(uv.x*aspect*tan(fov/2.),uv.y*tan(fov/2.),-1.));d=vec3(d.x*cos(roll)-d.y*sin(roll),d.x*sin(roll)+d.y*cos(roll),d.z);d=vec3(d.x,d.y*cos(pitch)-d.z*sin(pitch),d.y*sin(pitch)+d.z*cos(pitch));}
  d=vec3(d.x*cos(yaw)+d.z*sin(yaw),d.y,-d.x*sin(yaw)+d.z*cos(yaw));
  d=stabilization*d;
  vec2 st=vec2(atan(d.x,-d.z)/6.2831853+.5,asin(clamp(d.y,-1.,1.))/3.14159265+.5);
  gl_FragColor=mode>.5?sampleMax(d):texture2D(panorama,st);}`;
  const compile=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;};
  const program=gl.createProgram();gl.attachShader(program,compile(gl.VERTEX_SHADER,vertex));gl.attachShader(program,compile(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
  const p=gl.getAttribLocation(program,'p');gl.enableVertexAttribArray(p);gl.vertexAttribPointer(p,2,gl.FLOAT,false,0,0);
  const uniforms={};const loc=n=>uniforms[n]??(uniforms[n]=gl.getUniformLocation(program,n));
  const textures=[0,1].map(i=>{const t=gl.createTexture();gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,t);for(const pname of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,pname,gl.LINEAR);for(const pname of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,pname,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([0,0,0,255]));return t;});
  gl.uniform1i(loc('panorama'),0);gl.uniform1i(loc('trackOne'),1);
  let source=null,dirty=true,yaw=0,pitch=0,roll=0,fov=Math.PI/2,lastPointer=null,mode=0,session=null,referenceSpace=null;
  let stabilization=quaternionMatrix(IDENTITY_QUATERNION),orientationCallback=null,frameCallback=null,lastView=quaternionMatrix(IDENTITY_QUATERNION);
  let xrTransition=null;
  let xrCenter=quaternionMatrix(IDENTITY_QUATERNION),pendingRecenter=false;
  let xrPanel=null,panelStateCallback=null;
  let desktopMirror=false,mirrorPainted=false,mirrorQuality='performance',mirrorLimits=null;
  const panelError=error=>canvas.dispatchEvent(new CustomEvent('xrerror',{detail:`VR controls: ${error.message}`}));
  function togglePanel(input,reveal=false){
    try{
      xrPanel??=createXRPanel(gl,{getState:()=>panelStateCallback?.()||{},onAction:(action,value)=>{
        const current=session;
        Promise.resolve().then(()=>{if(!current||session!==current)return;if(action==='exit')return api.enterVR();canvas.dispatchEvent(new CustomEvent('xrpanelaction',{detail:{action,value}}));}).catch(panelError);
      }});
      if(reveal)xrPanel.show(input);else xrPanel.toggle(input);
    }catch(error){panelError(error);}
  }
  const zoomDetents=createZoomDetents();let lastWheelTime=null;
  const viewDrag=createXRViewDrag();let dragSource=null;
  const xrControls=createXRControls({togglePanel,showPanel:input=>togglePanel(input,true),zoom:(delta,time)=>{fov=zoomDetents.apply(fov,delta,time);},zoomEnd:()=>zoomDetents.release(),seek:seconds=>canvas.dispatchEvent(new CustomEvent('xrseek',{detail:seconds})),togglePlayback:()=>canvas.dispatchEvent(new Event('xrtoggleplay')),resetZoom:()=>{fov=Math.PI/2;zoomDetents.reset();},dragView:(active,input)=>{dragSource=active?input:null;viewDrag.setActive(active);}});
  function reportView(pose=null){const view=pose?multiplyMatrix3(viewRotationMatrix(yaw,0),multiplyMatrix3(xrCenter,viewRotationMatrix(0,0,pose))):multiplyMatrix3(viewRotationMatrix(yaw,pitch),quaternionMatrix([Math.cos(roll/2),0,0,Math.sin(roll/2)]));lastView=multiplyMatrix3(stabilization,view);orientationCallback?.(lastView.slice());}
  function upload(s,i){gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,textures[i]);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,s);}
  function uploadSource(){if(source&&(dirty||(source.tagName==='VIDEO'&&!source.paused))&&(source.tagName!=='VIDEO'||source.readyState>=2)){try{upload(source,0);}catch(error){source=null;canvas.dispatchEvent(new CustomEvent('rendererror',{detail:error.message}));}}dirty=false;}
  function render(w,h,xr=false){for(const [n,v]of Object.entries({aspect:w/Math.max(1,h),yaw,pitch,roll,fov,mode,xr:xr?1:0}))gl.uniform1f(loc(n),v);gl.uniformMatrix3fv(loc('stabilization'),false,stabilization);gl.uniformMatrix3fv(loc('xrCenter'),false,xrCenter);gl.drawArrays(gl.TRIANGLES,0,6);}
  function resizeDesktop(maxDimension=Infinity){
    const scale=Math.min(globalThis.devicePixelRatio||1,2),width=Math.max(1,Math.round(canvas.clientWidth*scale)),height=Math.max(1,Math.round(canvas.clientHeight*scale));
    const reduction=Math.min(1,maxDimension/Math.max(width,height)),w=Math.max(1,Math.round(width*reduction)),h=Math.max(1,Math.round(height*reduction));
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
    return {w,h};
  }
  function mirrorChanged(){canvas.dispatchEvent(new CustomEvent('xrmirrorchange',{detail:{enabled:desktopMirror,active:desktopMirror&&!!session,quality:mirrorQuality}}));}
  // Clear a previously mirrored image immediately on opt-out/tracking loss.
  // Never leave a stale headset frame exposed, or touch the XR layer here.
  function clearMirror(){
    if(!mirrorPainted)return;mirrorPainted=false;
    if(gl.isContextLost())return;
    const framebuffer=gl.getParameter(gl.FRAMEBUFFER_BINDING);
    try{gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.clearColor(0,0,0,1);gl.clear(gl.COLOR_BUFFER_BIT);}
    finally{gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);}
  }
  function drawXRView(view,viewport){
    gl.viewport(viewport.x,viewport.y,viewport.width,viewport.height);
    gl.uniformMatrix4fv(loc('invProjection'),false,invert4(view.projectionMatrix));
    gl.uniformMatrix4fv(loc('viewRotation'),false,view.transform.matrix);
    render(viewport.width,viewport.height,true);
    try{xrPanel?.draw(view);}catch(error){xrPanel?.reset();panelError(error);}
  }
  function drawDesktopMirror(pose,layer){
    if(!desktopMirror)return;
    const view=pose.views.find(view=>view.eye==='left')||pose.views[0];
    const eyeViewport=view&&layer.getViewport(view);
    if(!eyeViewport||!(eyeViewport.width>0&&eyeViewport.height>0)||!(canvas.clientWidth>0&&canvas.clientHeight>0)){clearMirror();return;}
    // Reuse a real eye's projection and pose, including asymmetric frusta, so
    // zoom and all panorama corrections are identical. Letterbox, never stretch.
    // This is another draw of existing textures, not readback, capture or decode.
    // Limit only the monitor buffer; never change the XR layer or eye viewport.
    // Query lazily so disabled mirroring does no extra graphics work.
    if(!mirrorLimits){
      const limit=value=>Number.isFinite(value)&&value>=1?Math.floor(value):1280;
      const viewportLimit=gl.getParameter(gl.MAX_VIEWPORT_DIMS);
      const maxDimension=Math.min(limit(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)),limit(gl.getParameter(gl.MAX_TEXTURE_SIZE)));
      mirrorLimits={maxWidth:Math.min(maxDimension,limit(viewportLimit?.[0])),maxHeight:Math.min(maxDimension,limit(viewportLimit?.[1]))};
    }
    const size=mirrorDrawingBufferSize(canvas.clientWidth,canvas.clientHeight,eyeViewport,{quality:mirrorQuality,pixelRatio:globalThis.devicePixelRatio,...mirrorLimits});
    if(canvas.width!==size.w||canvas.height!==size.h){canvas.width=size.w;canvas.height=size.h;}
    // Some implementations allocate a smaller default buffer under pressure.
    // Fit the buffer actually provided, rather than issuing an oversized draw.
    const w=typeof gl.drawingBufferWidth==='number'?gl.drawingBufferWidth:size.w,h=typeof gl.drawingBufferHeight==='number'?gl.drawingBufferHeight:size.h;
    if(!(w>0&&h>0))throw new Error('The monitor drawing buffer is unavailable.');
    const viewport=mirrorViewport(w,h,eyeViewport);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);mirrorPainted=true;
    gl.clearColor(0,0,0,1);gl.clear(gl.COLOR_BUFFER_BIT);
    drawXRView(view,viewport);
  }
  function draw(time){
    requestAnimationFrame(draw);if(gl.isContextLost()||session)return;
    frameCallback?.(time);uploadSource();reportView();const {w,h}=resizeDesktop();
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,w,h);render(w,h);
  }
  function xrDraw(time,frame){
    if(!session||(frame.session&&frame.session!==session))return;
    session.requestAnimationFrame(xrDraw);if(gl.isContextLost())return;
    xrControls.update(session,time);const pose=frame.getViewerPose(referenceSpace);
    if(!pose){viewDrag.rebase();xrPanel?.reset();clearMirror();return;}
    if(pendingRecenter){xrCenter=inverseViewRotation(pose.transform.matrix);yaw=0;pitch=0;roll=0;fov=Math.PI/2;pendingRecenter=false;viewDrag.rebase();}
    const dragSpace=dragSource?.gripSpace||dragSource?.targetRaySpace;
    const controllerPose=dragSpace?frame.getPose?.(dragSpace,referenceSpace):null;
    xrCenter=viewDrag.update(xrCenter,pose.transform.matrix,controllerPose?.transform.matrix);
    frameCallback?.(time);
    try{xrPanel?.update(session,time,frame,referenceSpace,pose.transform.matrix);}catch(error){xrPanel?.reset();panelError(error);}
    uploadSource();reportView(pose.transform.matrix);
    const layer=session.renderState.baseLayer;
    gl.bindFramebuffer(gl.FRAMEBUFFER,layer.framebuffer);gl.clear(gl.COLOR_BUFFER_BIT);
    let lastViewport=null;
    for(const view of pose.views){lastViewport=layer.getViewport(view);drawXRView(view,lastViewport);}
    if(!desktopMirror)return;
    try{
      if((session.visibilityState&&session.visibilityState!=='visible')||document.hidden){clearMirror();return;}
      drawDesktopMirror(pose,layer);
    }catch{
      // A monitor-only failure must not stop headset playback or the next frame.
      desktopMirror=false;clearMirror();mirrorChanged();
      canvas.dispatchEvent(new CustomEvent('xrmirrorerror',{detail:'Desktop mirror stopped. Headset playback can continue; try enabling the mirror again or leave it off.'}));
    }finally{
      gl.bindFramebuffer(gl.FRAMEBUFFER,layer.framebuffer);
      if(lastViewport)gl.viewport(lastViewport.x,lastViewport.y,lastViewport.width,lastViewport.height);
    }
  }
  function endPointer(){
    const pointer=lastPointer;lastPointer=null;
    if(pointer&&canvas.hasPointerCapture?.(pointer.id))canvas.releasePointerCapture(pointer.id);
  }
  canvas.addEventListener('pointerdown',e=>{
    if(lastPointer)return;
    if(e.button===1){e.preventDefault?.();canvas.focus();fov=Math.PI/2;zoomDetents.reset();lastWheelTime=null;return;}
    if(e.button!==undefined&&e.button!==0&&e.button!==2)return;
    e.preventDefault?.();canvas.focus();canvas.setPointerCapture(e.pointerId);
    lastPointer={id:e.pointerId,x:e.clientX,y:e.clientY,button:e.button??0};
  });
  canvas.addEventListener('pointermove',e=>{
    if(!lastPointer||e.pointerId!==lastPointer.id)return;
    if(e.buttons!==undefined&&!(e.buttons&(lastPointer.button===2?2:1))){endPointer();return;}
    if(lastPointer.button===2){
      // Camera-local Z: rightward dragging turns the image clockwise without
      // changing the center ray. Apply before pitch/yaw in both shader and audio.
      roll=(roll+(e.clientX-lastPointer.x)*.004)%(2*Math.PI);
    }else{
      yaw+=(e.clientX-lastPointer.x)*.004;
      pitch=Math.max(-1.5,Math.min(1.5,pitch+(e.clientY-lastPointer.y)*.004));
    }
    lastPointer.x=e.clientX;lastPointer.y=e.clientY;
  });
  for(const name of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(name,e=>{if(e.pointerId===lastPointer?.id)endPointer();});
  canvas.addEventListener('blur',endPointer);
  globalThis.window?.addEventListener('blur',endPointer);
  document.addEventListener?.('visibilitychange',()=>{if(document.hidden){endPointer();clearMirror();}});
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
  canvas.addEventListener('auxclick',e=>{if(e.button===1)e.preventDefault();});
  canvas.addEventListener('wheel',e=>{e.preventDefault();const time=e.timeStamp??performance.now();if(lastWheelTime===null||time-lastWheelTime>=150)zoomDetents.release();lastWheelTime=time;fov=zoomDetents.apply(fov,e.deltaY,time);},{passive:false});
  canvas.addEventListener('keydown',e=>{if(e.defaultPrevented||e.isComposing||e.altKey||e.ctrlKey||e.metaKey||!['ArrowUp','ArrowDown','+','=','-'].includes(e.key))return;e.preventDefault();pitch=Math.max(-1.5,Math.min(1.5,pitch+(e.key==='ArrowUp'?.1:e.key==='ArrowDown'?-.1:0)));const delta=e.key==='-'?100:['+','='].includes(e.key)?-100:0;if(delta)fov=zoomDetents.apply(fov,delta,e.timeStamp??performance.now());});
  canvas.addEventListener('keyup',e=>{if(['+','=','-'].includes(e.key))zoomDetents.release();});
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();mirrorPainted=false;canvas.dispatchEvent(new CustomEvent('rendererror',{detail:'Graphics context lost. Reload the player to restore playback.'}));});
  requestAnimationFrame(draw);
  const api={setSource(next){source=next;mode=0;dirty=true;stabilization=quaternionMatrix(IDENTITY_QUATERNION);},
    // Synchronous GPU upload. Caller retains ownership and may close frames immediately.
    setMaxSources(first,second,options={}){const width=options.width??first.displayWidth??first.videoWidth??first.width;const height=options.height??first.displayHeight??first.videoHeight??first.height;const l=maxLayout(width,height);const secondWidth=second.displayWidth??second.videoWidth??second.width;const secondHeight=second.displayHeight??second.videoHeight??second.height;if(!options.width&&(secondWidth!==width||secondHeight!==height))throw new Error('MAX track frames must have matching dimensions.');if(width>gl.getParameter(gl.MAX_TEXTURE_SIZE))throw new Error('This GPU cannot hold the MAX video textures.');if(gl.isContextLost())throw new Error('Graphics context is lost.');upload(first,0);upload(second,1);gl.uniform4f(loc('maxSize'),l.width,l.height,l.side,l.center);gl.uniform1f(loc('maxBlend'),l.blend);stabilization=quaternionMatrix(options.stabilization||IDENTITY_QUATERNION);source=null;mode=1;dirty=false;},
    // A single active render loop drives native media even when immersive XR
    // suppresses window animation frames; advance before texture/view upload.
    hideXRControls(){xrPanel?.reset();},
    setDesktopMirror(enabled){
      desktopMirror=!!enabled;if(!desktopMirror)clearMirror();mirrorChanged();
    },
    setDesktopMirrorQuality(quality){
      if(quality!=='performance'&&quality!=='headset')return;
      mirrorQuality=quality;mirrorChanged();
    },
    onXRPanelState(callback){panelStateCallback=callback;return ()=>{if(panelStateCallback===callback)panelStateCallback=null;};},
    onBeforeRender(callback){frameCallback=callback;return ()=>{if(frameCallback===callback)frameCallback=null;};},
    // Camera-to-raw-source sampling rotation, column-major. Includes XR and
    // gyro correction so an ambisonic listener follows the displayed view.
    onViewOrientation(callback){orientationCallback=callback;return ()=>{if(orientationCallback===callback)orientationCallback=null;};},
    getViewOrientation(){return lastView.slice();},
    refresh(){dirty=true;},reset(){endPointer();yaw=0;pitch=0;roll=0;fov=Math.PI/2;zoomDetents.reset();pendingRecenter=!!session;},
    async enterVR(){
      // requestSession must start in the user gesture, but only once while entry,
      // setup or exit is pending. A rapid second click joins the same operation.
      if(xrTransition)return xrTransition;
      const operation=(async()=>{
        if(session){await session.end();return;}
        if(!navigator.xr)throw new Error('Immersive WebXR is unavailable. Use a supported headset browser over HTTPS or localhost.');
        const next=await navigator.xr.requestSession('immersive-vr',{optionalFeatures:['local-floor']});
        let ended=false;
        next.addEventListener('end',()=>{
          ended=true;
          if(session!==next)return;
          xrControls.reset();viewDrag.reset();xrPanel?.reset();dragSource=null;pendingRecenter=false;xrCenter=quaternionMatrix(IDENTITY_QUATERNION);
          clearMirror();session=null;referenceSpace=null;if(desktopMirror)mirrorChanged();canvas.dispatchEvent(new Event('vrend'));
        });
        try{
          await gl.makeXRCompatible();
          if(ended)return;
          const ref=await next.requestReferenceSpace('local');
          if(ended)return;
          next.updateRenderState({baseLayer:new XRWebGLLayer(next,gl)});
          referenceSpace=ref;session=next;xrCenter=quaternionMatrix(IDENTITY_QUATERNION);pendingRecenter=false;xrControls.reset();viewDrag.reset();xrPanel?.reset();dragSource=null;
          if(desktopMirror)mirrorChanged();
          next.addEventListener('visibilitychange',()=>{if(session===next){xrControls.reset();viewDrag.reset();xrPanel?.reset();dragSource=null;pendingRecenter=false;if(next.visibilityState!=='visible')clearMirror();}});
          next.requestAnimationFrame(xrDraw);
        }catch(error){
          // Preserve the original setup error even if runtime cleanup also fails.
          if(!ended){try{await next.end();}catch{}}
          if(session===next){session=null;referenceSpace=null;}
          throw error;
        }
      })();
      xrTransition=operation;
      try{return await operation;}finally{if(xrTransition===operation)xrTransition=null;}
    }
  };
  const vr=document.getElementById('vr');if(vr){
    let supported=true;
    navigator.xr?.isSessionSupported('immersive-vr').then(ok=>{supported=ok;vr.disabled=!ok||!!xrTransition;vr.title=ok?'Enter immersive headset view':'No immersive VR device detected';}).catch(()=>{});
    vr.addEventListener('click',async()=>{
      if(xrTransition)return;
      vr.disabled=true;
      try{await api.enterVR();}
      catch(error){canvas.dispatchEvent(new CustomEvent('xrerror',{detail:error.message}));}
      finally{vr.textContent=session?'Exit VR':'Enter VR';vr.disabled=!supported;}
    });
    canvas.addEventListener('vrend',()=>vr.textContent='Enter VR');
  }
  return api;
}
// Match headset means the fitted image, not the letterboxed canvas, reaches
// the actual eye render resolution. CSS pixels/DPR do not describe XR pixels.
// Clamp the entire monitor buffer uniformly to keep its display aspect intact.
export function mirrorDrawingBufferSize(width,height,eye,{quality='performance',pixelRatio=1,maxWidth=1280,maxHeight=1280}={}){
  const positive=value=>Number.isFinite(value)&&value>0;
  if(!positive(width)||!positive(height))return {w:1,h:1};
  let w,h;
  if(quality==='headset'&&positive(eye?.width)&&positive(eye?.height)){
    const scale=Math.max(eye.width/width,eye.height/height);
    w=Math.ceil(width*scale);h=Math.ceil(height*scale);
  }else{
    const scale=Math.min(positive(pixelRatio)?pixelRatio:1,2);
    w=Math.max(1,Math.round(width*scale));h=Math.max(1,Math.round(height*scale));
    const reduction=Math.min(1,1280/Math.max(w,h));
    w=Math.max(1,Math.round(w*reduction));h=Math.max(1,Math.round(h*reduction));
  }
  const limit=value=>positive(value)?Math.max(1,Math.floor(value)):1280;
  const limitWidth=limit(maxWidth),limitHeight=limit(maxHeight),reduction=Math.min(1,limitWidth/w,limitHeight/h);
  return {w:Math.min(limitWidth,Math.max(1,Math.round(w*reduction))),h:Math.min(limitHeight,Math.max(1,Math.round(h*reduction)))};
}
// Fit one eye's render aspect without cropping its field of view. Coordinates
// are drawing-buffer pixels; black bars stay outside the returned viewport.
export function mirrorViewport(width,height,eye){
  const scale=Math.min(width/eye.width,height/eye.height);
  const w=Math.max(1,Math.round(eye.width*scale)),h=Math.max(1,Math.round(eye.height*scale));
  return {x:Math.floor((width-w)/2),y:Math.floor((height-h)/2),width:w,height:h};
}
// Gauss-Jordan inversion; column-major WebXR matrices.
export function invert4(input){const rows=Array.from({length:4},(_,r)=>Array.from({length:8},(_,c)=>c<4?input[c*4+r]:+(c-4===r)));for(let c=0;c<4;c++){let pivot=c;for(let r=c+1;r<4;r++)if(Math.abs(rows[r][c])>Math.abs(rows[pivot][c]))pivot=r;if(Math.abs(rows[pivot][c])<1e-12)throw new Error('Singular projection matrix');[rows[c],rows[pivot]]=[rows[pivot],rows[c]];const n=rows[c][c];rows[c]=rows[c].map(v=>v/n);for(let r=0;r<4;r++)if(r!==c){const k=rows[r][c];rows[r]=rows[r].map((v,i)=>v-k*rows[c][i]);}}return new Float32Array(Array.from({length:16},(_,i)=>rows[i%4][4+Math.floor(i/4)]));}
export function demoPanorama(){
  const c=document.createElement('canvas');c.width=2048;c.height=1024;const x=c.getContext('2d');
  const sky=x.createLinearGradient(0,0,0,1024);sky.addColorStop(0,'#0b2930');sky.addColorStop(.48,'#b1bc8c');sky.addColorStop(.5,'#64745a');sky.addColorStop(1,'#16261b');x.fillStyle=sky;x.fillRect(0,0,2048,1024);
  for(let layer=0;layer<4;layer++){x.fillStyle=['#748b75','#506e5b','#345540','#223e2d'][layer];x.beginPath();x.moveTo(0,1024);for(let i=0;i<=2048;i+=4){const a=i/2048*Math.PI*2;x.lineTo(i,500+layer*48-65*Math.sin(a*7+layer)-35*Math.cos(a*13+layer*2)-18*Math.sin(a*23));}x.lineTo(2048,1024);x.fill();}
  x.fillStyle='#f2e7ac';x.beginPath();x.arc(1150,360,35,0,Math.PI*2);x.fill();
  x.font='16px sans-serif';x.textAlign='center';x.fillStyle='#d7e7c5';for(let i=0;i<4;i++){x.fillText(['SOUTH','WEST','NORTH','EAST'][i],256+i*512,690);x.fillRect(256+i*512,710,1,45);}return c;
}
