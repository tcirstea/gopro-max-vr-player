// World-anchored, stereo WebXR transport. All positions are in reference-space
// metres, independent of panorama zoom/drag. No DOM overlay support is required.
const WIDTH=1.2, HEIGHT=.375;
const clamp=x=>Math.max(0,Math.min(1,x));
const dot=(a,b)=>a.reduce((n,v,i)=>n+v*b[i],0);
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const norm=a=>{const n=Math.hypot(...a);return n>1e-8?a.map(v=>v/n):[0,0,1];};
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export function placePanel(ray,viewer){
 const center=[ray[12]-ray[8]*1.6,ray[13]-ray[9]*1.6,ray[14]-ray[10]*1.6];
 const normal=norm(sub(viewer.slice(12,15),center));
 const right=norm(cross(Math.abs(normal[1])>.98?[0,0,1]:[0,1,0],normal));
 const up=cross(normal,right);
 return {center,normal,right,up};
}
export function panelHit(panel,ray){
 if(!panel||!ray)return null;
 const origin=Array.from(ray.slice(12,15)),direction=[-ray[8],-ray[9],-ray[10]],denom=dot(direction,panel.normal);
 if(denom>=-1e-6)return null;
 const distance=dot(sub(panel.center,origin),panel.normal)/denom;
 if(distance<0)return null;
 const offset=sub(origin.map((v,i)=>v+direction[i]*distance),panel.center);
 const u=.5+dot(offset,panel.right)/WIDTH,v=.5-dot(offset,panel.up)/HEIGHT;
 return u>=0&&u<=1&&v>=0&&v<=1?{u,v}:null;
}
export function panelTarget(hit,state={}){
 if(!hit)return null;
 const {u,v}=hit;
 if(v>=.53&&v<=.78&&u>=.06&&u<=.94)return state.canSeek?'seek':null;
 if(v<.12||v>.43)return null;
 if(u>=.04&&u<=.24)return state.canPrevious?'previous':null;
 if(u>=.28&&u<=.48)return state.canPlay?'play':null;
 if(u>=.52&&u<=.72)return state.canNext?'next':null;
 if(u>=.76&&u<=.96)return 'exit';
 return null;
}
export function createPanelTimer(){
 let elapsed=0,last=null;
 return {reset(){elapsed=0;last=null;},update(time,playing,interacting=false){const dt=last===null?0:Math.max(0,Math.min(250,time-last));last=time;if(interacting)elapsed=0;else if(playing)elapsed+=dt;return elapsed>=2000;}};
}
export function createXRPanel(gl,{getState=()=>({}),onAction=()=>{}}={}){
 let panel=null,pending=null,visible=false,capture=null,preview=null,lastPaint='',hover=null,mediaId;
 const buttons=new Map(),timer=createPanelTimer();
 const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=320;
 const ctx=canvas.getContext('2d');
 const shader=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
 const program=gl.createProgram();
 const vs=shader(gl.VERTEX_SHADER,'attribute vec2 p; uniform mat4 projection,view; uniform vec3 center,right,up; varying vec2 uv; void main(){uv=vec2(p.x*.5+.5,.5-p.y*.5);gl_Position=projection*view*vec4(center+right*p.x*.6+up*p.y*.1875,1.);}');
 const fs=shader(gl.FRAGMENT_SHADER,'precision mediump float;uniform sampler2D panel;varying vec2 uv;void main(){gl_FragColor=texture2D(panel,uv);}');
 gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);
 if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
 const attribute=gl.getAttribLocation(program,'p'),loc=n=>gl.getUniformLocation(program,n);
 const buffer=gl.createBuffer(),texture=gl.createTexture();
 // Do not disturb the panorama's buffer binding during lazy initialization.
 const oldBuffer=gl.getParameter(gl.ARRAY_BUFFER_BINDING);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);gl.bindBuffer(gl.ARRAY_BUFFER,oldBuffer);
 function getPose(frame,space,referenceSpace){try{return space?frame.getPose(space,referenceSpace):null;}catch{return null;}}
 function reset(){panel=null;pending=null;visible=false;capture=null;preview=null;hover=null;buttons.clear();timer.reset();lastPaint='';}
 function act(action,value){onAction(action,value);timer.reset();}
 function paint(state){
 const progress=preview??(state.duration>0?clamp(state.currentTime/state.duration):0);
 const key=JSON.stringify([state.playing,state.canPlay,state.canSeek,state.canPrevious,state.canNext,Math.floor(state.currentTime||0),Math.floor(state.duration||0),progress,hover]);
 if(key===lastPaint)return;lastPaint=key;
 ctx.fillStyle='#11232c';ctx.fillRect(0,0,1024,320);
 for(const [i,action]of ['previous','play','next','exit'].entries()){
  const enabled=action==='exit'||state[{previous:'canPrevious',play:'canPlay',next:'canNext'}[action]];
  ctx.fillStyle=hover?.target===action?'#3f7284':'#263f4a';ctx.fillRect((.04+i*.24)*1024,.12*320,.2*1024,.31*320);
  ctx.fillStyle=enabled?'#ffffff':'#77858b';ctx.font='bold 29px sans-serif';ctx.textAlign='center';ctx.fillText({previous:'Previous',play:state.playing?'Pause':'Play',next:'Next',exit:'Exit VR'}[action],(.14+i*.24)*1024,.31*320);
 }
 ctx.fillStyle='#52646a';ctx.fillRect(.06*1024,.64*320,.88*1024,12);ctx.fillStyle=state.canSeek?'#9ce2dc':'#77858b';ctx.fillRect(.06*1024,.64*320,.88*1024*progress,12);
 ctx.beginPath();ctx.arc((.06+.88*progress)*1024,.64*320+6,12,0,Math.PI*2);ctx.fill();
 const format=n=>{n=Number.isFinite(n)?Math.max(0,Math.floor(n)):0;return `${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`;};
 ctx.font='24px sans-serif';ctx.fillStyle='#d6e6eb';ctx.textAlign='left';ctx.fillText(`${format(preview===null?state.currentTime:progress*state.duration)} / ${format(state.duration)}`,62,282);ctx.textAlign='right';ctx.fillText('Trigger to select · B / Y to hide',962,282);
 if(hover){ctx.strokeStyle='#fff';ctx.lineWidth=3;ctx.beginPath();ctx.arc(hover.u*1024,hover.v*320,10,0,Math.PI*2);ctx.stroke();}
 gl.bindTexture(gl.TEXTURE_2D,texture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,canvas);
 for(const name of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,name,gl.LINEAR);
 for(const name of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,name,gl.CLAMP_TO_EDGE);
 }
 return {reset,toggle(source){if(visible||pending){reset();}else{pending=source;timer.reset();}},
 update(session,time,frame,referenceSpace,viewer){
  if(session.visibilityState&&session.visibilityState!=='visible'){reset();return;}
  const sources=Array.from(session.inputSources||[]).filter(s=>['left','right'].includes(s.handedness)&&s.targetRaySpace&&!s.hand&&s.gamepad?.mapping==='xr-standard'&&s.gamepad.connected!==false);
  if(pending){const pose=sources.includes(pending)&&getPose(frame,pending.targetRaySpace,referenceSpace);if(pose&&viewer){panel=placePanel(pose.transform.matrix,viewer);pending=null;visible=true;timer.reset();}else if(!sources.includes(pending)){pending=null;}}
  if(!visible)return;
  const state=getState();hover=null;
  if(state.mediaId!==mediaId){capture=null;preview=null;mediaId=state.mediaId;timer.reset();}
  if(capture&&!sources.includes(capture.source)){capture=null;preview=null;}
  for(const s of [...buttons.keys()])if(!sources.includes(s))buttons.delete(s);
  for(const source of sources){
   const down=!!source.gamepad.buttons?.[0]?.pressed,previous=buttons.has(source)?buttons.get(source):down;buttons.set(source,down);
   const pose=getPose(frame,source.targetRaySpace,referenceSpace);
   if(!pose&&capture?.source===source){capture=null;preview=null;}
   const hit=panelHit(panel,pose?.transform.matrix),target=panelTarget(hit,state);
   if(hit&&(!hover||(!capture&&target&&!hover.target)||capture?.source===source))hover={...hit,target};
   if(down&&!previous&&target&&!capture){capture={source,target};if(target==='seek')preview=clamp((hit.u-.06)/.88);timer.reset();}
   if(capture?.source===source){
    if(capture.target==='seek'&&hit)preview=clamp((hit.u-.06)/.88);
    if(!down){const selected=capture.target;capture=null;if(selected==='seek'){if(state.canSeek&&preview!==null)act('seek',preview);preview=null;}else if(target===selected)act(selected);}
   }
  }
  if(timer.update(time,!!(state.advancing??state.playing),!!capture)){reset();}
 },
 draw(view){
  if(!visible||!panel)return;
  const old={program:gl.getParameter(gl.CURRENT_PROGRAM),buffer:gl.getParameter(gl.ARRAY_BUFFER_BINDING),active:gl.getParameter(gl.ACTIVE_TEXTURE),flip:gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL),depth:gl.isEnabled(gl.DEPTH_TEST),blend:gl.isEnabled(gl.BLEND),enabled:gl.getVertexAttrib(attribute,gl.VERTEX_ATTRIB_ARRAY_ENABLED),attribBuffer:gl.getVertexAttrib(attribute,gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING),size:gl.getVertexAttrib(attribute,gl.VERTEX_ATTRIB_ARRAY_SIZE),type:gl.getVertexAttrib(attribute,gl.VERTEX_ATTRIB_ARRAY_TYPE),normalized:gl.getVertexAttrib(attribute,gl.VERTEX_ATTRIB_ARRAY_NORMALIZED),stride:gl.getVertexAttrib(attribute,gl.VERTEX_ATTRIB_ARRAY_STRIDE),offset:gl.getVertexAttribOffset(attribute,gl.VERTEX_ATTRIB_ARRAY_POINTER)};
  gl.activeTexture(gl.TEXTURE0);const oldTexture=gl.getParameter(gl.TEXTURE_BINDING_2D);
  try{paint(getState());gl.useProgram(program);gl.disable(gl.DEPTH_TEST);gl.disable(gl.BLEND);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.enableVertexAttribArray(attribute);gl.vertexAttribPointer(attribute,2,gl.FLOAT,false,0,0);gl.bindTexture(gl.TEXTURE_2D,texture);gl.uniform1i(loc('panel'),0);
  gl.uniformMatrix4fv(loc('projection'),false,view.projectionMatrix);gl.uniformMatrix4fv(loc('view'),false,view.transform.inverse.matrix);for(const n of ['center','right','up'])gl.uniform3fv(loc(n),panel[n]);gl.drawArrays(gl.TRIANGLES,0,6);
  }finally{if(old.attribBuffer){gl.bindBuffer(gl.ARRAY_BUFFER,old.attribBuffer);gl.vertexAttribPointer(attribute,old.size,old.type,old.normalized,old.stride,old.offset);}if(!old.enabled)gl.disableVertexAttribArray(attribute);
  gl.bindBuffer(gl.ARRAY_BUFFER,old.buffer);gl.bindTexture(gl.TEXTURE_2D,oldTexture);gl.activeTexture(old.active);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,old.flip);if(old.depth)gl.enable(gl.DEPTH_TEST);if(old.blend)gl.enable(gl.BLEND);gl.useProgram(old.program);}
 },dispose(){reset();gl.deleteTexture(texture);gl.deleteBuffer(buffer);gl.deleteProgram(program);}};
}
