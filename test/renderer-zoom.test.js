import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRenderer} from '../src/renderer.js';
function harness(hand='right'){
 const keys=['requestAnimationFrame','document','navigator','XRWebGLLayer'],saved=Object.fromEntries(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 const events={},sessionEvents={},uniforms={};let windowFrame,xrFrame;
 const gl=new Proxy({getShaderParameter:()=>true,getProgramParameter:()=>true,getParameter:()=>8192,isContextLost:()=>false,getUniformLocation:(_p,n)=>n,uniform1f:(n,v)=>uniforms[n]=v},{get:(t,k)=>k in t?t[k]:/^[A-Z_0-9]+$/.test(k)?1:()=>({})});
 const canvas={clientWidth:400,clientHeight:300,getContext:()=>gl,addEventListener:(n,f)=>events[n]=f,dispatchEvent:e=>events[e.type]?.(e)};
 const source={handedness:hand,gamepad:{mapping:'xr-standard',axes:[0,0,0,0],buttons:Array.from({length:6},()=>({pressed:false}))}};
 const session={visibilityState:'visible',inputSources:[source],renderState:{},async requestReferenceSpace(){return {};},updateRenderState(s){Object.assign(this.renderState,s);},addEventListener(n,f){sessionEvents[n]=f;},requestAnimationFrame(f){xrFrame=f;},async end(){sessionEvents.end?.();}};
 const globals={requestAnimationFrame:f=>windowFrame=f,document:{getElementById:()=>null},navigator:{xr:{requestSession:async()=>session}},XRWebGLLayer:class{getViewport(){return {x:0,y:0,width:400,height:300};}}};
 for(const [k,v]of Object.entries(globals))Object.defineProperty(globalThis,k,{value:v,writable:true,configurable:true});
 const renderer=createRenderer(canvas),matrix=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],frame={getViewerPose:()=>({transform:{matrix},views:[{projectionMatrix:matrix,transform:{matrix}}]})};
 return {renderer,source,uniforms,wheel(deltaY,timeStamp){events.wheel({deltaY,timeStamp,preventDefault(){}});windowFrame(timeStamp);},key(key,timeStamp){events.keydown({key,timeStamp,preventDefault(){}});windowFrame(timeStamp);},release(){events.keyup({key:'+'});},tick:t=>xrFrame(t,frame),restore(){for(const k of keys){if(saved[k])Object.defineProperty(globalThis,k,saved[k]);else delete globalThis[k];}}};
}
test('renderer wheel detents pause at old bounds/default and continue to expanded hard limits',()=>{
 const h=harness();try{
 h.wheel(-5000,0);assert.equal(h.uniforms.fov,.4);
 for(const t of [100,200,300,400,499]){h.wheel(-5000,t);assert.equal(h.uniforms.fov,.4);}
 h.wheel(-5000,500);assert.equal(h.uniforms.fov,.15);h.wheel(-5000,510);assert.equal(h.uniforms.fov,.15);
 // Opposite direction crosses the old minimum, default and old maximum in order.
 h.wheel(5000,520);assert.equal(h.uniforms.fov,.4);h.wheel(5000,700);assert.equal(h.uniforms.fov,Math.PI/2,'new wheel gesture after 150ms releases prior stop');
 h.wheel(5000,710);assert.equal(h.uniforms.fov,Math.PI/2);h.wheel(5000,900);assert.equal(h.uniforms.fov,2.1);h.wheel(5000,1100);assert.equal(h.uniforms.fov,2.8);h.wheel(5000,1300);assert.equal(h.uniforms.fov,2.8);
 }finally{h.restore();}
});
test('renderer keyboard holds at detents but key release immediately permits continuation',()=>{
 const h=harness();try{
 let t=0;while(h.uniforms.fov!==.4&&t<100){h.key('+',++t);}assert.equal(h.uniforms.fov,.4);
 h.key('+',t+100);assert.equal(h.uniforms.fov,.4);h.release();h.key('+',t+101);assert.ok(h.uniforms.fov<.4);
 for(let i=0;i<8;i++)h.key('+',t+102+i);assert.equal(h.uniforms.fov,.15);
 h.renderer.reset();h.key('-',200);assert.ok(h.uniforms.fov>Math.PI/2,'starting at the default is not trapped');
 }finally{h.restore();}
});
for(const hand of ['right','left'])test(`renderer ${hand} stick stops for 500ms, releases on neutral and reaches expanded bounds`,async()=>{
 const h=harness(hand);try{
 h.wheel(-5000,0);h.release();h.wheel(10,1);h.release();assert.ok(Math.abs(h.uniforms.fov-.41)<1e-10);
 await h.renderer.enterVR();h.tick(0);h.source.gamepad.axes[3]=-1;h.tick(50);assert.equal(h.uniforms.fov,.4);
 for(const t of [100,200,300,400,500,549]){h.tick(t);assert.equal(h.uniforms.fov,.4);}
 h.tick(550);assert.ok(h.uniforms.fov<.4);h.tick(600);assert.ok(h.uniforms.fov<.38,'same stop must not immediately retrigger');
 let time=600;while(h.uniforms.fov>.15&&time<2000){h.tick(time+=50);}assert.equal(h.uniforms.fov,.15);
 // Reverse: neutral release lets us continue from the old min before 500ms.
 h.source.gamepad.axes[3]=1;while(h.uniforms.fov!==.4&&time<3000)h.tick(time+=50);assert.equal(h.uniforms.fov,.4);const stopped=time;
 h.source.gamepad.axes[3]=0;h.tick(time+=10);h.source.gamepad.axes[3]=1;h.tick(time+=10);assert.ok(h.uniforms.fov>.4);assert.ok(time-stopped<500);
 for(const mark of [Math.PI/2,2.1]){
  while(h.uniforms.fov!==mark&&time<12000)h.tick(time+=50);assert.equal(h.uniforms.fov,mark);const at=time;
  h.tick(time=at+499);assert.equal(h.uniforms.fov,mark);h.tick(time=at+500);assert.ok(h.uniforms.fov>mark);
 }
 while(h.uniforms.fov<2.8&&time<15000)h.tick(time+=50);assert.equal(h.uniforms.fov,2.8);
 }finally{h.restore();}
});
