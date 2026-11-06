import {test} from 'node:test';
import assert from 'node:assert/strict';
import {placePanel,panelHit,panelTarget,createPanelTimer,createXRPanel} from '../src/xr-panel.js';
const identity=()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
test('panel is placed along controller ray and stays world anchored',()=>{
 const ray=identity(),viewer=identity();ray[12]=.3;const panel=placePanel(ray,viewer);
 assert.deepEqual(panel.center,[.3,0,-1.6]);const hit=panelHit(panel,ray);assert.ok(Math.abs(hit.u-.5)<1e-8);assert.ok(Math.abs(hit.v-.5)<1e-8);
 ray[12]=10;assert.equal(panelHit(panel,ray),null);assert.deepEqual(panel.center,[.3,0,-1.6]);
 const behind=identity();behind[10]=-1;assert.equal(panelHit(panel,behind),null);
 const overhead=identity();overhead[9]=-1;overhead[10]=0;assert.ok(placePanel(overhead,viewer).right.every(Number.isFinite));
});
test('buttons and broad progress target respect capabilities',()=>{
 const state={canMute:true,canPrevious:true,canPlay:true,canNext:true,canSeek:true};
 for(const [u,action] of [[.12,'previous'],[.312,'play'],[.504,'next'],[.696,'mute'],[.888,'exit']])assert.equal(panelTarget({u,v:.25},state),action);
 assert.equal(panelTarget({u:.1,v:.6},state),'seek');assert.equal(panelTarget({u:.1,v:.6},{}),null);
 assert.equal(panelTarget({u:.312,v:.25},{}),null);assert.equal(panelTarget({u:.888,v:.25},{}),'exit');
});
test('auto-hide counts two seconds only while playing, holds during interaction and resets cleanly',()=>{
 const timer=createPanelTimer();for(let t=0;t<=5000;t+=100)assert.equal(timer.update(t,false),false);
 for(let t=5100;t<7000;t+=100)assert.equal(timer.update(t,true),false);assert.equal(timer.update(7000,true),true);
 timer.reset();for(let t=0;t<=5000;t+=100)assert.equal(timer.update(t,true,true),false);
 for(let t=5100;t<7000;t+=100)assert.equal(timer.update(t,true),false);assert.equal(timer.update(7000,true),true);
});
function harness(t){
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'document');t.after(()=>descriptor?Object.defineProperty(globalThis,'document',descriptor):delete globalThis.document);
 const ctx=new Proxy({},{get:(obj,key)=>key in obj?obj[key]:()=>{}});globalThis.document={createElement:()=>({getContext:()=>ctx})};
 const gl=new Proxy({getShaderParameter:()=>true,getProgramParameter:()=>true},{get:(obj,key)=>key in obj?obj[key]:/^[A-Z_0-9]+$/.test(key)?key:()=>({})});
 const actions=[],state={mediaId:1,canPlay:true,canSeek:true,canPrevious:true,canNext:true,canMute:true,muted:true,playing:false,duration:100,currentTime:20};
 const left={handedness:'left',targetRaySpace:{},gamepad:{mapping:'xr-standard',buttons:[{pressed:false}]}};
 const right={handedness:'right',targetRaySpace:{},gamepad:{mapping:'xr-standard',buttons:[{pressed:false}]}};
 const rays=new Map([[left.targetRaySpace,identity()],[right.targetRaySpace,identity()]]);
 const session={inputSources:[left,right],visibilityState:'visible'};const frame={getPose:space=>rays.get(space)?{transform:{matrix:rays.get(space)}}:null};
 const panel=createXRPanel(gl,{getState:()=>state,onAction:(...args)=>actions.push(args)});let time=0;
 const tick=()=>panel.update(session,time+=16,frame,{},identity());
 const aim=(source,u,v)=>{const ray=identity();ray[12]=(u-.5)*1.2;ray[13]=(.5-v)*.375;rays.set(source.targetRaySpace,ray);};
 const trigger=(source,down)=>{source.gamepad.buttons[0].pressed=down;tick();};
 panel.toggle(right);tick();return {panel,tick,aim,trigger,left,right,session,state,actions,rays,gl,ctx};
}
test('either hand can activate transport with trigger press/release; held button never repeats',t=>{
 const h=harness(t);h.aim(h.left,.312,.25);h.trigger(h.left,true);h.tick();assert.deepEqual(h.actions,[]);h.trigger(h.left,false);assert.deepEqual(h.actions,[['play',undefined]]);
 h.aim(h.right,.888,.25);h.trigger(h.right,true);h.trigger(h.right,false);assert.equal(h.actions.at(-1)[0],'exit');
});
test('scrub previews throughout drag and commits once on release',t=>{
 const h=harness(t);h.aim(h.right,.28,.65);h.trigger(h.right,true);h.aim(h.right,.72,.65);h.tick();assert.deepEqual(h.actions,[]);h.trigger(h.right,false);assert.equal(h.actions.length,1);assert.equal(h.actions[0][0],'seek');assert.ok(Math.abs(h.actions[0][1]-.75)<1e-6);
});
test('toggle, focus loss, tracking loss, disconnect and clip change cancel captured seeks',t=>{
 const h=harness(t);
 for(const interruption of ['toggle','focus','tracking','disconnect','media']){
  h.panel.reset();h.session.inputSources=[h.left,h.right];h.session.visibilityState='visible';h.right.gamepad.buttons[0].pressed=false;h.rays.set(h.right.targetRaySpace,identity());h.panel.toggle(h.right);h.tick();h.aim(h.right,.5,.65);h.trigger(h.right,true);
  if(interruption==='toggle')h.panel.toggle(h.left);
  if(interruption==='focus')h.session.visibilityState='hidden';
  if(interruption==='tracking')h.rays.delete(h.right.targetRaySpace);
  if(interruption==='disconnect')h.session.inputSources=[h.left];
  if(interruption==='media')h.state.mediaId++;
  h.tick();h.trigger(h.right,false);assert.deepEqual(h.actions,[],interruption);
 }
});
test('holding trigger on initial appearance requires release before selection',t=>{
 const h=harness(t);h.panel.reset();h.right.gamepad.buttons[0].pressed=true;h.panel.toggle(h.right);h.tick();h.aim(h.right,.312,.25);h.trigger(h.right,false);assert.deepEqual(h.actions,[]);
 h.trigger(h.right,true);h.trigger(h.right,false);assert.equal(h.actions.length,1);
});

test('panel draw restores panorama GPU bindings even if texture painting fails',t=>{
 const h=harness(t),g=h.gl;
 const parameters={CURRENT_PROGRAM:'panorama',ARRAY_BUFFER_BINDING:'quad',ACTIVE_TEXTURE:'TEXTURE1',UNPACK_FLIP_Y_WEBGL:true,TEXTURE_BINDING_2D:'video'};
 g.getParameter=name=>parameters[name];g.getVertexAttrib=(index,name)=>({VERTEX_ATTRIB_ARRAY_ENABLED:true,VERTEX_ATTRIB_ARRAY_BUFFER_BINDING:'quad',VERTEX_ATTRIB_ARRAY_SIZE:2,VERTEX_ATTRIB_ARRAY_TYPE:'FLOAT',VERTEX_ATTRIB_ARRAY_NORMALIZED:false,VERTEX_ATTRIB_ARRAY_STRIDE:0}[name]);g.getVertexAttribOffset=()=>0;g.isEnabled=()=>true;
 g.activeTexture=value=>parameters.ACTIVE_TEXTURE=value;g.bindTexture=(target,value)=>parameters.TEXTURE_BINDING_2D=value;g.bindBuffer=(target,value)=>parameters.ARRAY_BUFFER_BINDING=value;g.useProgram=value=>parameters.CURRENT_PROGRAM=value;g.pixelStorei=(name,value)=>parameters[name]=value;
 const original={...parameters};h.panel.draw({projectionMatrix:identity(),transform:{inverse:{matrix:identity()}}});assert.deepEqual(parameters,original);
 h.state.currentTime++;g.texImage2D=()=>{throw Error('GPU upload failed');};assert.throws(()=>h.panel.draw({projectionMatrix:identity(),transform:{inverse:{matrix:identity()}}}),/GPU upload failed/);assert.deepEqual(parameters,original);
});

test('mute is selected once per index-trigger click by either hand, but never when unavailable',t=>{
 const h=harness(t);
 for(const hand of [h.left,h.right]){
  h.aim(hand,.696,.25);h.trigger(hand,true);h.tick();assert.equal(h.actions.length,hand===h.left?0:1);h.trigger(hand,false);
 }
 assert.deepEqual(h.actions,[['mute',undefined],['mute',undefined]]);
 h.state.canMute=false;h.trigger(h.right,true);h.trigger(h.right,false);assert.equal(h.actions.length,2);
 assert.equal(panelTarget({u:.696,v:.25},{}),null);
});
test('mute label repaints immediately after browser state changes, without exposing audio styles',t=>{
 const h=harness(t),labels=[];h.ctx.fillText=text=>labels.push(text);
 const view={projectionMatrix:identity(),transform:{inverse:{matrix:identity()}}};h.panel.draw(view);
 assert.ok(labels.includes('Unmute'));assert.ok(!labels.some(x=>/stereo|ambisonic|spatial/i.test(x)));
 labels.length=0;h.state.muted=false;h.panel.draw(view);assert.ok(labels.includes('Mute'));assert.ok(!labels.includes('Unmute'));
 labels.length=0;h.state.canMute=false;h.panel.draw(view);assert.ok(labels.includes('Mute'));
});

test('trigger reveal does not toggle a visible panel and opening press cannot select',t=>{
 const h=harness(t);h.panel.reset();h.right.gamepad.buttons[0].pressed=true;h.panel.show(h.right);h.tick();h.aim(h.right,.312,.25);h.trigger(h.right,false);assert.deepEqual(h.actions,[]);
 h.panel.show(h.left);h.trigger(h.right,true);h.trigger(h.right,false);assert.deepEqual(h.actions,[['play',undefined]]);
});
function openPlaylist(h){
 h.aim(h.right,.78,.9);h.trigger(h.right,true);h.trigger(h.right,false);
 // The playlist window is taller, while retaining the same world-space center.
 return (u,v)=>{h.aim(h.right,u,.5+(v-.5)*.9/.375);h.trigger(h.right,true);h.trigger(h.right,false);};
}
test('playlist supports five sorts, direction, grid/list, paging and selection hides before action',t=>{
 const h=harness(t);h.state.playlist={items:Array.from({length:13},(_,i)=>({id:i,name:`clip ${i}`,thumbnail:null})),sort:'added',version:0};
 const click=openPlaylist(h);
 for(const [i,key] of ['added','name','size','dateTaken','fileCreated'].entries())click(.10+i*.186,.21);
 assert.deepEqual(h.actions.map(a=>a.slice(0,2)),['added','name','size','dateTaken','fileCreated'].map(key=>['playlist-sort',key]));
 click(.75,.11);assert.equal(h.actions.at(-1)[0],'playlist-direction');
 click(.4,.11); // grid, six per page
 click(.8,.94); // page two
 click(.15,.4);assert.deepEqual(h.actions.at(-1),['playlist-select',6]);
 let draws=0;h.gl.drawArrays=()=>draws++;h.panel.draw({});assert.equal(draws,0,'all VR controls hidden after selecting');
 h.rays.set(h.right.targetRaySpace,identity());h.panel.show(h.right);h.tick();const clickAgain=openPlaylist(h); // grid preference retained
 clickAgain(.4,.11); // list, five per page
 clickAgain(.8,.94);clickAgain(.1,.32);assert.deepEqual(h.actions.at(-1),['playlist-select',5]);
});
test('playlist remains open during playback and shows thumbnails, selected item and empty state',t=>{
 const h=harness(t);h.state.playlist={items:[{id:'a',name:'a.mp4',thumbnail:{width:320,height:180}}],selectedId:'a',version:1};h.state.playing=true;
 const click=openPlaylist(h);for(let i=0;i<300;i++)h.tick();
 const labels=[],images=[];h.ctx.fillText=text=>labels.push(text);h.ctx.drawImage=(...args)=>images.push(args);
 const view={projectionMatrix:identity(),transform:{inverse:{matrix:identity()}}};h.panel.draw(view);assert.ok(labels.includes('a.mp4'));assert.equal(images.length,1);
 h.state.playlist={items:[],version:2};h.panel.draw(view);assert.ok(labels.some(text=>text.includes('Add videos')));
 click(.1,.11);h.aim(h.right,.312,.25);h.trigger(h.right,true);h.trigger(h.right,false);assert.equal(h.actions.at(-1)[0],'play');
});
test('playlist hit rectangles stay within bounds, page indices clamp and missing metadata stays selectable',async()=>{
 const {playlistLayout,playlistTarget}=await import('../src/xr-panel.js');
 for(const mode of ['list','grid']){
  const layout=playlistLayout({items:Array.from({length:15},(_,id)=>({id}))},mode,999);
  assert.ok(layout.page<layout.pages);assert.ok(!layout.targets.some(t=>t.action==='page-next'));
  for(const r of layout.targets){assert.ok(r.x>=0&&r.y>=0&&r.x+r.w<=1&&r.y+r.h<=1);assert.equal(playlistTarget({u:r.x+r.w/2,v:r.y+r.h/2},layout),r.action);}
 }
 assert.equal(playlistLayout({},'list',-2).page,0);
});

test('large VR rows double height, halve thumbnail density and preserve ray targets and paging',async()=>{
 const {playlistLayout,playlistTarget}=await import('../src/xr-panel.js');
 const items=Array.from({length:11},(_,id)=>({id})),normal=playlistLayout({items}),large=playlistLayout({items,doubleHeightRows:true});
 const rows=l=>l.targets.filter(t=>t.item);
 assert.equal(rows(normal).length,5);assert.equal(rows(large).length,2);assert.equal(rows(large)[0].h,rows(normal)[0].h*2);
 assert.equal(large.pages,6);assert.equal(rows(playlistLayout({items,doubleHeightRows:true},'list',5))[0].item.id,10);
 for(const mode of ['list','grid']){
  const layout=playlistLayout({items,doubleHeightRows:true},mode,999);
  for(const r of layout.targets){assert.ok(r.x>=0&&r.y>=0&&r.x+r.w<=1&&r.y+r.h<=1);assert.equal(playlistTarget({u:r.x+r.w/2,v:r.y+r.h/2},layout),r.action);}
 }
 assert.deepEqual(playlistLayout({items,doubleHeightRows:true},'grid'),playlistLayout({items},'grid'));
});
test('wide VR previews use twice the previous large width without stretching and density repaints',t=>{
 const h=harness(t),images=[],labels=[];h.ctx.drawImage=(...args)=>images.push(args);h.ctx.fillText=text=>labels.push(text);
 h.state.playlist={items:Array.from({length:6},(_,id)=>({id,name:`clip ${id}`,thumbnail:{width:320,height:105}})),version:1};
 const click=openPlaylist(h),view={projectionMatrix:identity(),transform:{inverse:{matrix:identity()}}};
 h.panel.draw(view);const normal=images[0];assert.equal(images.length,5);
 images.length=0;h.state.playlist.doubleHeightRows=true;h.panel.draw(view);assert.equal(images.length,2);
 assert.equal(images[0][3],normal[3]*4);assert.equal(images[0][4],normal[4]*4);assert.equal(images[0][3]/images[0][4],320/105);
 click(.8,.94);h.panel.draw(view);assert.ok(labels.includes('Page 2 / 3'));
 click(.1,.33);assert.deepEqual(h.actions.at(-1),['playlist-select',2]);
});
test('VR density change cancels held item capture before a moved row can be selected',t=>{
 const h=harness(t);h.state.playlist={items:Array.from({length:10},(_,id)=>({id,name:`clip ${id}`})),version:1};
 openPlaylist(h);h.aim(h.right,.1,.5+(.32-.5)*.9/.375);h.trigger(h.right,true);
 h.state.playlist.doubleHeightRows=true;h.trigger(h.right,false);assert.deepEqual(h.actions,[]);
 h.trigger(h.right,true);h.trigger(h.right,false);assert.deepEqual(h.actions,[['playlist-select',0]]);
});


test('VR filename, size and plain date occupy separate bounded lines in normal, large and grid views',t=>{
 const h=harness(t),labels=[],images=[];h.ctx.fillText=(...args)=>labels.push(args);h.ctx.drawImage=(...args)=>images.push(args);
 h.state.playlist={items:[{id:'a',name:'A very long filename '.repeat(20),added:1,size:2*1048576,dateTaken:Date.UTC(2024,3,15,12),thumbnail:{width:320,height:180}}],version:1};
 const click=openPlaylist(h),view={projectionMatrix:identity(),transform:{inverse:{matrix:identity()}}};
 for(const mode of ['normal','large','grid']){
  if(mode==='large')h.state.playlist.doubleHeightRows=true;
  if(mode==='grid')click(.4,.11);
  labels.length=0;images.length=0;h.panel.draw(view);
  const title=labels.find(a=>a[0].startsWith('1. A very')),size=labels.find(a=>a[0]==='2.0 MiB'),date=labels.find(a=>a[0]==='2024-04-15 12:00:00');
  assert.ok(title&&size&&date,mode);assert.ok(title[0].endsWith('…'));
  assert.equal(title[1],size[1]);assert.equal(size[1],date[1]);assert.ok(title[2]<size[2]&&size[2]<date[2]);
  const right=(mode==='grid'?.04+.294:.96)*1024,bottom=(.28+(mode==='grid'?.27:mode==='large'?.21:.105))*768;
  for(const label of [title,size,date]){assert.ok(label[1]+label[3]<=right);assert.ok(label[2]<bottom);}
  assert.equal(images.length,1);assert.ok(Math.abs(images[0][3]/images[0][4]-320/180)<1e-10);
  if(mode==='grid')assert.ok(images[0][2]+images[0][4]<title[2]-20);
  else assert.ok(images[0][1]+images[0][3]<title[1]);
  assert.ok(!labels.some(a=>/Embedded|Firmware|codec|unstitched/.test(a[0])));
 }
 labels.length=0;h.state.playlist.items[0].dateTaken=null;h.state.playlist.version++;h.panel.draw(view);assert.ok(labels.some(a=>a[0]==='Date unavailable'));
});
