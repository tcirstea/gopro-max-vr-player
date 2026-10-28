export function createRenderer(canvas) {
  const gl = canvas.getContext('webgl', {alpha:false, antialias:false});
  if (!gl) throw new Error('WebGL is unavailable. Enable hardware acceleration to use the panorama viewer.');
  const vertex = 'attribute vec2 p; varying vec2 uv; void main(){uv=p;gl_Position=vec4(p,0.,1.);}';
  const fragment = `precision mediump float; varying vec2 uv; uniform sampler2D panorama; uniform float aspect,yaw,pitch,fov;
  void main(){ vec3 d=normalize(vec3(uv.x*aspect*tan(fov/2.),uv.y*tan(fov/2.),-1.));
  d=vec3(d.x,d.y*cos(pitch)-d.z*sin(pitch),d.y*sin(pitch)+d.z*cos(pitch));
  d=vec3(d.x*cos(yaw)+d.z*sin(yaw),d.y,-d.x*sin(yaw)+d.z*cos(yaw));
  vec2 st=vec2(atan(d.x,-d.z)/6.2831853+.5,asin(clamp(d.y,-1.,1.))/3.14159265+.5);
  gl_FragColor=texture2D(panorama,st); }`;
  const compile = (type, source) => {const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader));return shader;};
  const program=gl.createProgram();gl.attachShader(program,compile(gl.VERTEX_SHADER,vertex));gl.attachShader(program,compile(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error('Unable to initialize panorama shader.');
  gl.useProgram(program);const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
  const p=gl.getAttribLocation(program,'p');gl.enableVertexAttribArray(p);gl.vertexAttribPointer(p,2,gl.FLOAT,false,0,0);
  const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
  let source=null,dirty=true,yaw=0,pitch=0,fov=Math.PI/2,lastPointer=null;
  function draw(){
    if(gl.isContextLost())return;
    const scale=Math.min(devicePixelRatio||1,2),w=Math.round(canvas.clientWidth*scale),h=Math.round(canvas.clientHeight*scale);
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;dirty=true;}
    if(source && (dirty || (source.tagName==='VIDEO' && !source.paused)) && (source.tagName!=='VIDEO'||source.readyState>=2)){
      try{gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,source);}catch(error){source=null;canvas.dispatchEvent(new CustomEvent('rendererror',{detail:error.message}));}
    }
    gl.viewport(0,0,w,h);for(const [name,value] of Object.entries({aspect:w/Math.max(1,h),yaw,pitch,fov}))gl.uniform1f(gl.getUniformLocation(program,name),value);
    gl.drawArrays(gl.TRIANGLES,0,6);dirty=false;requestAnimationFrame(draw);
  }
  canvas.addEventListener('pointerdown',e=>{canvas.focus();canvas.setPointerCapture(e.pointerId);lastPointer=[e.clientX,e.clientY];});
  canvas.addEventListener('pointermove',e=>{if(!lastPointer)return;yaw+=(e.clientX-lastPointer[0])*.004;pitch=Math.max(-1.5,Math.min(1.5,pitch+(e.clientY-lastPointer[1])*.004));lastPointer=[e.clientX,e.clientY];});
  for(const name of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(name,()=>lastPointer=null);
  canvas.addEventListener('wheel',e=>{e.preventDefault();fov=Math.max(.4,Math.min(2.1,fov+e.deltaY*.001));},{passive:false});
  canvas.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-'].includes(e.key))return;e.preventDefault();yaw+=e.key==='ArrowLeft'?.1:e.key==='ArrowRight'?-.1:0;pitch=Math.max(-1.5,Math.min(1.5,pitch+(e.key==='ArrowUp'?.1:e.key==='ArrowDown'?-.1:0)));fov=Math.max(.4,Math.min(2.1,fov+(e.key==='-'?.1:['+','='].includes(e.key)?-.1:0)));});
  requestAnimationFrame(draw);
  return {setSource(next){source=next;dirty=true;},refresh(){dirty=true;},reset(){yaw=0;pitch=0;fov=Math.PI/2;}};
}
export function demoPanorama(){
  const c=document.createElement('canvas');c.width=2048;c.height=1024;const x=c.getContext('2d');
  const sky=x.createLinearGradient(0,0,0,1024);sky.addColorStop(0,'#0b2930');sky.addColorStop(.48,'#b1bc8c');sky.addColorStop(.5,'#64745a');sky.addColorStop(1,'#16261b');x.fillStyle=sky;x.fillRect(0,0,2048,1024);
  for(let layer=0;layer<4;layer++){x.fillStyle=['#748b75','#506e5b','#345540','#223e2d'][layer];x.beginPath();x.moveTo(0,1024);for(let i=0;i<=2048;i+=4){const a=i/2048*Math.PI*2;x.lineTo(i,500+layer*48-65*Math.sin(a*7+layer)-35*Math.cos(a*13+layer*2)-18*Math.sin(a*23));}x.lineTo(2048,1024);x.fill();}
  x.fillStyle='#f2e7ac';x.beginPath();x.arc(1150,360,35,0,Math.PI*2);x.fill();
  x.font='16px sans-serif';x.textAlign='center';x.fillStyle='#d7e7c5';for(let i=0;i<4;i++){x.fillText(['SOUTH','WEST','NORTH','EAST'][i],256+i*512,690);x.fillRect(256+i*512,710,1,45);}return c;
}
