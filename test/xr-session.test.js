import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRenderer} from '../src/renderer.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function harness(t){
 const keys=['requestAnimationFrame','document','navigator','XRWebGLLayer'];
 const saved=Object.fromEntries(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 t.after(()=>{for(const key of keys){if(saved[key])Object.defineProperty(globalThis,key,saved[key]);else delete globalThis[key];}});
 const requests=[],events=[],handlers={},button={disabled:false,textContent:'Enter VR',addEventListener:(name,fn)=>handlers[name]=fn};let windowFrame,draws=0;
 const gl=new Proxy({getShaderParameter:()=>true,getProgramParameter:()=>true,isContextLost:()=>false,makeXRCompatible:async()=>{},drawArrays:()=>draws++},{get:(obj,key)=>key in obj?obj[key]:/^[A-Z_0-9]+$/.test(key)?1:()=>({})});
 const canvas={clientWidth:100,clientHeight:100,getContext:()=>gl,addEventListener(){},dispatchEvent:event=>events.push(event)};
 const globals={requestAnimationFrame:fn=>windowFrame=fn,document:{getElementById:()=>button},navigator:{xr:{isSessionSupported:async()=>true,requestSession(){const d=deferred();requests.push(d);return d.promise;}}},XRWebGLLayer:class{}};
 for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
 const renderer=createRenderer(canvas);
 return {renderer,requests,gl,events,button,click:()=>handlers.click(),draw:()=>windowFrame(0),get draws(){return draws;}};
}
function session(){const handlers={};return {ends:0,frames:0,addEventListener:(name,fn)=>handlers[name]=fn,async requestReferenceSpace(){return {};},updateRenderState(){},requestAnimationFrame(){this.frames++;},emitEnd(){handlers.end?.();},async end(){this.ends++;this.emitEnd();}};}
test('rapid entry calls and clicks request only one immersive session through pending setup',async t=>{
 const h=harness(t),setup=deferred(),s=session();h.gl.makeXRCompatible=()=>setup.promise;
 const first=h.click(),second=h.click(),third=h.renderer.enterVR();assert.equal(h.requests.length,1);assert.equal(h.button.disabled,true);
 h.requests[0].resolve(s);await Promise.resolve();const fourth=h.renderer.enterVR();assert.equal(h.requests.length,1);
 setup.resolve();await Promise.all([first,second,third,fourth]);assert.equal(s.frames,1);assert.equal(h.button.textContent,'Exit VR');assert.equal(h.button.disabled,false);
 const exit=deferred();s.end=()=>{s.ends++;return exit.promise;};const a=h.renderer.enterVR(),b=h.renderer.enterVR();assert.equal(s.ends,1);s.emitEnd();exit.resolve();await Promise.all([a,b]);h.draw();assert.equal(h.draws,1);
});
test('runtime request failure uses VR error channel and permits desktop rendering and retry',async t=>{
 const h=harness(t);const click=h.click();h.requests[0].reject(Error('There is already an active, immersive XRSession.'));await click;
 assert.equal(h.events.at(-1).type,'xrerror');assert.match(h.events.at(-1).detail,/active/);assert.equal(h.button.disabled,false);assert.equal(h.button.textContent,'Enter VR');h.draw();assert.equal(h.draws,1);
 const retry=h.click();h.requests[1].resolve(session());await retry;assert.equal(h.button.textContent,'Exit VR');
});
test('end during asynchronous setup does not resurrect a dead immersive session',async t=>{
 const h=harness(t),setup=deferred(),s=session();h.gl.makeXRCompatible=()=>setup.promise;
 const first=h.renderer.enterVR();h.requests[0].resolve(s);await Promise.resolve();s.emitEnd();setup.resolve();await first;
 assert.equal(s.frames,0);h.draw();assert.equal(h.draws,1);
 const retry=h.renderer.enterVR();h.requests[1].resolve(session());await retry;
});
test('setup failure ends acquired session and preserves original error if cleanup fails',async t=>{
 const h=harness(t),s=session();h.gl.makeXRCompatible=async()=>{throw Error('graphics setup failed');};s.end=async()=>{s.ends++;throw Error('cleanup failed');};
 const entry=h.renderer.enterVR();h.requests[0].resolve(s);await assert.rejects(entry,/graphics setup failed/);assert.equal(s.ends,1);h.draw();assert.equal(h.draws,1);
 h.gl.makeXRCompatible=async()=>{};const retry=h.renderer.enterVR();h.requests[1].resolve(session());await retry;
});
