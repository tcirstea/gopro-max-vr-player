import {createXRControls,zoomFov} from './xr-controls.js';
import {maxLayout,MAX_GLSL} from './max-projection.js';
import {IDENTITY_QUATERNION,quaternionMatrix,multiplyMatrix3,viewRotationMatrix} from './quaternion.js';
export function createRenderer(canvas) {
  const gl=canvas.getContext('webgl',{alpha:false,antialias:false,xrCompatible:true});
  if(!gl)throw new Error('WebGL is unavailable. Enable hardware acceleration.');
  const vertex='attribute vec2 p; varying vec2 uv; void main(){uv=p;gl_Position=vec4(p,0.,1.);}';
  const fragment=`precision highp float; varying vec2 uv; uniform sampler2D panorama; uniform float aspect,yaw,pitch,fov,mode,xr;uniform mat4 invProjection,viewRotation;uniform mat3 stabilization;
  ${MAX_GLSL}
  void main(){vec3 d;
  if(xr>.5){vec3 eyeRay=(invProjection*vec4(uv,-1.,1.)).xyz;eyeRay.xy*=tan(fov/2.);d=normalize(mat3(viewRotation)*eyeRay);}
  else {d=normalize(vec3(uv.x*aspect*tan(fov/2.),uv.y*tan(fov/2.),-1.));d=vec3(d.x,d.y*cos(pitch)-d.z*sin(pitch),d.y*sin(pitch)+d.z*cos(pitch));}
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
  let source=null,dirty=true,yaw=0,pitch=0,fov=Math.PI/2,lastPointer=null,mode=0,session=null,referenceSpace=null;
  let stabilization=quaternionMatrix(IDENTITY_QUATERNION),orientationCallback=null,frameCallback=null,lastView=quaternionMatrix(IDENTITY_QUATERNION);
  const xrControls=createXRControls({zoom:delta=>{fov=zoomFov(fov,delta);},seek:seconds=>canvas.dispatchEvent(new CustomEvent('xrseek',{detail:seconds})),togglePlayback:()=>canvas.dispatchEvent(new Event('xrtoggleplay'))});
  function reportView(pose=null){lastView=multiplyMatrix3(stabilization,viewRotationMatrix(yaw,pitch,pose));orientationCallback?.(lastView.slice());}
  function upload(s,i){gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,textures[i]);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,s);}
  function uploadSource(){if(source&&(dirty||(source.tagName==='VIDEO'&&!source.paused))&&(source.tagName!=='VIDEO'||source.readyState>=2)){try{upload(source,0);}catch(error){source=null;canvas.dispatchEvent(new CustomEvent('rendererror',{detail:error.message}));}}dirty=false;}
  function render(w,h,xr=false){for(const [n,v]of Object.entries({aspect:w/Math.max(1,h),yaw,pitch,fov,mode,xr:xr?1:0}))gl.uniform1f(loc(n),v);gl.uniformMatrix3fv(loc('stabilization'),false,stabilization);gl.drawArrays(gl.TRIANGLES,0,6);}
  function draw(time){requestAnimationFrame(draw);if(gl.isContextLost()||session)return;frameCallback?.(time);uploadSource();reportView();const scale=Math.min(globalThis.devicePixelRatio||1,2),w=Math.max(1,Math.round(canvas.clientWidth*scale)),h=Math.max(1,Math.round(canvas.clientHeight*scale));if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,w,h);render(w,h);}
  function xrDraw(time,frame){if(!session)return;session.requestAnimationFrame(xrDraw);xrControls.update(session,time);const pose=frame.getViewerPose(referenceSpace);if(!pose)return;frameCallback?.(time);uploadSource();reportView(pose.transform.matrix);const layer=session.renderState.baseLayer;gl.bindFramebuffer(gl.FRAMEBUFFER,layer.framebuffer);gl.clear(gl.COLOR_BUFFER_BIT);for(const view of pose.views){const v=layer.getViewport(view);gl.viewport(v.x,v.y,v.width,v.height);gl.uniformMatrix4fv(loc('invProjection'),false,invert4(view.projectionMatrix));gl.uniformMatrix4fv(loc('viewRotation'),false,view.transform.matrix);render(v.width,v.height,true);}}
  canvas.addEventListener('pointerdown',e=>{canvas.focus();canvas.setPointerCapture(e.pointerId);lastPointer=[e.clientX,e.clientY];});
  canvas.addEventListener('pointermove',e=>{if(!lastPointer)return;yaw+=(e.clientX-lastPointer[0])*.004;pitch=Math.max(-1.5,Math.min(1.5,pitch+(e.clientY-lastPointer[1])*.004));lastPointer=[e.clientX,e.clientY];});
  for(const name of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(name,()=>lastPointer=null);
  canvas.addEventListener('wheel',e=>{e.preventDefault();fov=zoomFov(fov,e.deltaY);},{passive:false});
  canvas.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-'].includes(e.key))return;e.preventDefault();yaw+=e.key==='ArrowLeft'?.1:e.key==='ArrowRight'?-.1:0;pitch=Math.max(-1.5,Math.min(1.5,pitch+(e.key==='ArrowUp'?.1:e.key==='ArrowDown'?-.1:0)));fov=Math.max(.4,Math.min(2.1,fov+(e.key==='-'?.1:['+','='].includes(e.key)?-.1:0)));});
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();canvas.dispatchEvent(new CustomEvent('rendererror',{detail:'Graphics context lost. Reload the player to restore playback.'}));});
  requestAnimationFrame(draw);
  const api={setSource(next){source=next;mode=0;dirty=true;stabilization=quaternionMatrix(IDENTITY_QUATERNION);},
    // Synchronous GPU upload. Caller retains ownership and may close frames immediately.
    setMaxSources(first,second,options={}){const width=options.width??first.displayWidth??first.videoWidth??first.width;const height=options.height??first.displayHeight??first.videoHeight??first.height;const l=maxLayout(width,height);const secondWidth=second.displayWidth??second.videoWidth??second.width;const secondHeight=second.displayHeight??second.videoHeight??second.height;if(!options.width&&(secondWidth!==width||secondHeight!==height))throw new Error('MAX track frames must have matching dimensions.');if(width>gl.getParameter(gl.MAX_TEXTURE_SIZE))throw new Error('This GPU cannot hold the MAX video textures.');if(gl.isContextLost())throw new Error('Graphics context is lost.');upload(first,0);upload(second,1);gl.uniform4f(loc('maxSize'),l.width,l.height,l.side,l.center);gl.uniform1f(loc('maxBlend'),l.blend);stabilization=quaternionMatrix(options.stabilization||IDENTITY_QUATERNION);source=null;mode=1;dirty=false;},
    // A single active render loop drives native media even when immersive XR
    // suppresses window animation frames; advance before texture/view upload.
    onBeforeRender(callback){frameCallback=callback;return ()=>{if(frameCallback===callback)frameCallback=null;};},
    // Camera-to-raw-source sampling rotation, column-major. Includes XR and
    // gyro correction so an ambisonic listener follows the displayed view.
    onViewOrientation(callback){orientationCallback=callback;return ()=>{if(orientationCallback===callback)orientationCallback=null;};},
    getViewOrientation(){return lastView.slice();},
    refresh(){dirty=true;},reset(){yaw=0;pitch=0;fov=Math.PI/2;},
    async enterVR(){if(session){await session.end();return;}if(!navigator.xr)throw new Error('Immersive WebXR is unavailable. Use a supported headset browser over HTTPS or localhost.');const next=await navigator.xr.requestSession('immersive-vr',{optionalFeatures:['local-floor']});try{await gl.makeXRCompatible();const ref=await next.requestReferenceSpace('local');next.updateRenderState({baseLayer:new XRWebGLLayer(next,gl)});referenceSpace=ref;session=next;xrControls.reset();next.addEventListener('visibilitychange',()=>xrControls.reset());next.addEventListener('end',()=>{xrControls.reset();session=null;canvas.dispatchEvent(new Event('vrend'));});next.requestAnimationFrame(xrDraw);}catch(e){await next.end();throw e;}}
  };
  const vr=document.getElementById('vr');if(vr){navigator.xr?.isSessionSupported('immersive-vr').then(ok=>{vr.disabled=!ok;vr.title=ok?'Enter immersive headset view':'No immersive VR device detected';}).catch(()=>{});vr.addEventListener('click',async()=>{try{await api.enterVR();vr.textContent=session?'Exit VR':'Enter VR';}catch(error){canvas.dispatchEvent(new CustomEvent('rendererror',{detail:error.message}));}});canvas.addEventListener('vrend',()=>vr.textContent='Enter VR');}
  return api;
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
