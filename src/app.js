import {createNativePlayer} from './native-player.js';
import {inspectFile,formatTime} from './inspect.js';
import {createRenderer,demoPanorama} from './renderer.js';
import {createPlaylistEntries,sortPlaylistEntries,PLAYLIST_SORTS} from './playlist-model.js';
import {createPlaylistBrowser} from './playlist-browser.js';
import {readPlaylistMetadata,createPlaylistThumbnail} from './playlist-media.js';
const $=id=>document.getElementById(id), video=$('video');
// Preferences belong to this page session, not to the loaded media. A temporary
// unsupported-mode fallback must never overwrite the user's preferred mode.
const preferences={muted:$('muted').checked,volume:1,audioMode:'stereo'};
function syncAudioPreferences(){
 $('muted').checked=preferences.muted;$('volume').value=preferences.volume;
 video.muted=preferences.muted;video.volume=preferences.volume;
 nativePlayer?.setMuted(preferences.muted);nativePlayer?.setVolume?.(preferences.volume);
}
function applyNativePreferences(player){
 if(player.audioState?.modes.includes(preferences.audioMode) && player.audioState.mode!==preferences.audioMode)player.setAudioMode(preferences.audioMode);
 syncAudioPreferences();
}

let renderer,objectURL=null,generation=0,pendingFile=null,nativePlayer=null,nativeTime=0,nativeAdvancing=false;
let playlist=[],playlistIndex=-1,playWhenReady=false,playlistEpoch=0,playlistVersion=0,playlistSort='added',playlistDescending=false;
let previewAbort=null,previewRunning=false,mediaOpening=false,pendingPlayback=0;
const confirmedProjection=new WeakSet();
function playlistState(){return {items:playlist,selectedId:playlist[playlistIndex]?.id,sort:playlistSort,descending:playlistDescending,version:playlistVersion};}
const playlistBrowser=createPlaylistBrowser({getState:playlistState,onSelect:selectPlaylistItem,onSort:sortPlaylist,onDirection:()=>sortPlaylist(playlistSort,!playlistDescending)});
function stopPreview(){previewAbort?.abort();}
function isPlaying(){return !!(nativePlayer?.playing||(!video.paused&&objectURL));}
function schedulePreviews(){
 if(previewRunning||mediaOpening||pendingPlayback>0||isPlaying()||!playlist.length)return;
 const epoch=playlistEpoch;
 previewRunning=true;previewAbort=new AbortController();const signal=previewAbort.signal;
 (async()=>{
  try{for(const item of playlist.slice()){
   if(signal.aborted||epoch!==playlistEpoch||isPlaying()||mediaOpening)break;
   if(item.thumbnailDone||!item.metadataDone)continue;
   let thumbnail=null;try{thumbnail=await createPlaylistThumbnail(item.file,{signal});}catch{}
   if(signal.aborted||epoch!==playlistEpoch)break;
   item.thumbnail=thumbnail;item.thumbnailDone=true;playlistVersion++;playlistBrowser.render();
  }}finally{previewRunning=false;previewAbort=null;if(signal.aborted&&!mediaOpening&&!isPlaying())schedulePreviews();}
 })();
}
async function enrichPlaylist(epoch){
 for(const item of playlist.slice()){
  if(epoch!==playlistEpoch)return;
  try{Object.assign(item,await readPlaylistMetadata(item.file));}catch{}
  if(epoch!==playlistEpoch)return;
  item.metadataDone=true;playlistVersion++;
  if(playlistSort==='dateTaken'||playlistSort==='fileCreated')sortPlaylist(playlistSort,playlistDescending);else playlistBrowser.render();
 }
 schedulePreviews();
}
function sortPlaylist(key,descending=playlistDescending){
 if(!PLAYLIST_SORTS.includes(key))return;
 const selected=playlist[playlistIndex]?.id;playlistSort=key;playlistDescending=!!descending;
 playlist=sortPlaylistEntries(playlist,key,playlistDescending);
 playlistIndex=playlist.findIndex(item=>item.id===selected);playlistVersion++;syncPlaylist();
}
function selectPlaylistItem(id){
 const index=playlist.findIndex(item=>item.id===id);if(index<0)return;
 playlistBrowser.close();renderer?.hideXRControls?.();$('viewer').classList?.add('controls-hidden');$('canvas').focus?.();
 return selectClip(index,true);
}
function syncPlaylist(){
 $('previous').disabled=playlistIndex<=0;
 $('next').disabled=playlistIndex<0||playlistIndex>=playlist.length-1;
 $('playlist').hidden=playlist.length===0;
 $('playlist-position').textContent=playlist.length?`${playlistIndex+1} / ${playlist.length}`:'';
 $('playlist-select').replaceChildren(...playlist.map((item,index)=>{const option=document.createElement('option');option.value=String(index);option.textContent=`${item.added}. ${item.name}`;return option;}));
 $('playlist-select').value=String(playlistIndex);$('open-playlist').disabled=!playlist.length;playlistBrowser.render();
}
function setPlaylist(files){
 if(!files.length)return;
 stopPreview();playlistEpoch++;playlistVersion++;playlist=createPlaylistEntries(files,playlistEpoch);playlistIndex=-1;
 playlist=sortPlaylistEntries(playlist,playlistSort,playlistDescending);
 const opened=selectClip(0,false);enrichPlaylist(playlistEpoch);return opened;
}
function selectClip(index,autoplay=nativePlayer?.playing||(!video.paused&&!!objectURL)||playWhenReady){
 if(!Number.isInteger(index)||index<0||index>=playlist.length)return;
 playlistIndex=index;playWhenReady=!!autoplay;syncPlaylist();
 return openFile(playlist[index].file);
}
function advancePlaylist(current){
 // Run outside a decoder callback: closing its player synchronously would
 // otherwise invalidate the frames that the callback is still presenting.
 Promise.resolve().then(()=>{if(current===generation&&playlistIndex>=0&&playlistIndex<playlist.length-1)selectClip(playlistIndex+1,true);});
}
async function resumeWhenReady(current){
 if(!playWhenReady||current!==generation)return;
 playWhenReady=false;pendingPlayback++;
 try{stopPreview();if(nativePlayer)await nativePlayer.play();else await video.play();}
 catch(error){if(current===generation)status(`Playback blocked: ${error.message}. Press Play to continue.`);}
 finally{if(current===generation){pendingPlayback--;schedulePreviews();}}
}
$('previous').addEventListener('click',()=>selectClip(playlistIndex-1));
$('next').addEventListener('click',()=>selectClip(playlistIndex+1));
$('playlist-select').addEventListener('change',event=>selectPlaylistItem(playlist[Number(event.target.value)]?.id));
for(const type of ['pointerdown','keydown'])$('canvas').addEventListener(type,()=>$('viewer').classList?.remove('controls-hidden'));
syncPlaylist();
const status=message=>$('status').textContent=message;
function playbackStatus(message){const element=$('playback-state');if(element.textContent!==message)element.textContent=message;element.hidden=!message;}
try{renderer=createRenderer($('canvas'));renderer.setSource(demoPanorama());renderer.onBeforeRender?.(time=>nativePlayer?.advance(time));renderer.onViewOrientation?.(rotation=>nativePlayer?.setViewRotation(rotation));}catch(error){status(error.message);}
// Read live transport state each XR frame; buffering must not consume the
// panel's two seconds of actual playback. The provider also works in demo mode.
renderer?.onXRPanelState?.(()=>({
 mediaId:generation,playing:nativePlayer?nativePlayer.playing:!!objectURL&&!video.paused&&!video.ended,
 advancing:nativePlayer?nativeAdvancing:!!objectURL&&!video.paused&&!video.ended&&!video.seeking&&video.readyState>=3,
 currentTime:nativePlayer?nativeTime:video.currentTime,duration:nativePlayer?nativePlayer.duration:video.duration,
 canPlay:!$('play').disabled,canSeek:!$('seek').disabled,canMute:!$('muted').disabled,muted:preferences.muted,
 canPrevious:!$('previous').disabled,canNext:!$('next').disabled,playlist:playlistState()
}));
$('canvas').addEventListener('xrpanelaction',event=>{
 const {action,value}=event.detail||{};
 if(action==='playlist-select')selectPlaylistItem(value);
 else if(action==='playlist-sort')sortPlaylist(value);
 else if(action==='playlist-direction')sortPlaylist(playlistSort,!playlistDescending);
 else if(action==='play')togglePlayback();
 else if(action==='mute'&&!$('muted').disabled){preferences.muted=!preferences.muted;syncAudioPreferences();}
 else if(action==='previous')selectClip(playlistIndex-1);
 else if(action==='next')selectClip(playlistIndex+1);
 else if(action==='seek'&&!$('seek').disabled&&Number.isFinite(value)){
  const duration=nativePlayer?nativePlayer.duration:video.duration;
  if(!Number.isFinite(duration)||duration<=0)return;
  const target=Math.max(0,Math.min(1,value))*duration;
  try{if(nativePlayer){nativePlayer.seek(target);nativeTime=target;}else video.currentTime=target;}
  catch(error){status(`Seeking failed: ${error.message}`);}
 }
});
const hasHEVC=video.canPlayType('video/mp4; codecs="hvc1.1.6.L153.B0"');
$('capabilities').textContent=`This browser: WebGL ${renderer?'available':'unavailable'} · WebCodecs ${'VideoDecoder' in window?'available':'unavailable'} · HEVC media hint: ${hasHEVC||'not reported'}. These hints do not validate native MAX playback.`;
function clearMedia(){nativeTime=0;nativeAdvancing=false;nativePlayer?.close();nativePlayer=null;$('diagnostics-panel').hidden=true;playbackStatus('');$('play').textContent='Play';$('muted').disabled=false;$('audio-mode').hidden=true;syncAudioPreferences();video.pause();video.removeAttribute('src');video.load();if(objectURL)URL.revokeObjectURL(objectURL);objectURL=null;pendingFile=null;$('play').disabled=true;$('seek').disabled=true;$('seek').value=0;$('time').textContent='0:00 / 0:00';$('equirect').hidden=true;renderer?.setSource(demoPanorama());$('source').textContent='DEMO PANORAMA';$('view-title').textContent='Take a look around';}
async function openFile(file){
 stopPreview();mediaOpening=true;pendingPlayback=0;const current=++generation;let ended=false;clearMedia();$('filename').textContent=file.name;$('metadata').textContent='';status('Inspecting local container metadata…');
 try{const info=await inspectFile(file);if(current!==generation)return;
 $('metadata').textContent=`${(file.size/1024/1024).toFixed(1)} MiB · Container brand: ${info.brand||'unknown'}\n`+info.tracks.map((t,i)=>`Track ${i+1}: ${t.type} / ${t.codec}${t.width?` / ${t.width} × ${t.height}`:''}`).join('\n');
 if(info.nativeCandidate){
  if(!renderer)throw new Error('WebGL is required for native playback.');
  status('Native dual-track candidate detected. Checking HEVC decoders and loading paired frames locally…');
  const player=await createNativePlayer(file,{autoTick:false,
   onFrames(a,b,options){if(current!==generation)return;renderer.setMaxSources(a,b,options);$('source').textContent='LOCAL MAX · EXPERIMENTAL EAC';$('view-title').textContent='Your point of view';},
   onState(state){if(current!==generation)return;nativeTime=state.currentTime;nativeAdvancing=state.playing&&!state.buffering&&!state.preparing;playbackStatus(state.preparing?(state.inputStrategy==='chunked-prefetch'?'Preparing 64 MiB playback buffers in local memory…':'Preparing this short clip in local memory…'):state.buffering?'Buffering paired video frames… Playback time is held until frames are ready.':state.playing?`Playing locally · ${state.audio?.available?(state.audio.mode==='ambisonic'?'Head-relative ambisonic headphones':state.audio.mode+' audio'):'Audio unavailable on this browser'}.`:'');$('play').textContent=state.playing?'Pause':'Play';if(state.playing)stopPreview();else schedulePreviews();$('time').textContent=`${formatTime(state.currentTime)} / ${formatTime(state.duration)}`;$('seek').value=state.currentTime/state.duration*1000;if(state.audio){$('muted').disabled=!state.audio.available;$('audio-mode').hidden=state.audio.modes.length<2;$('audio-mode').value=state.audio.mode;}if(!state.playing&&state.duration>0&&state.currentTime>=state.duration&&!ended){ended=true;advancePlaylist(current);}},
   onError(error){if(current===generation){playbackStatus('');$('play').disabled=true;$('seek').disabled=true;playWhenReady=false;status(`Native decoder stopped: ${error.message}. Use Next to skip this clip.`);}}
  });
  if(current!==generation){player.close();return;}nativePlayer=player;$('diagnostics-panel').hidden=false;$('play').disabled=false;$('seek').disabled=false;applyNativePreferences(player);$('muted').disabled=!player.audioState?.available;$('audio-mode').hidden=(player.audioState?.modes.length||0)<2;$('audio-mode').value=player.audioState?.mode||'stereo';
  status('Experimental native MAX pipeline opened locally. Press Play. Dual HEVC frames are mapped as EAC; overlap blending is included; native audio is synchronized when supported. Your audio preferences are retained; headphone mode uses verified spatial metadata. Optical-flow seam correction is not implemented. Codec support does not guarantee real-time playback.'+(player.audioState?.available&&!player.audioState.modes.includes(preferences.audioMode)?` Preferred ${preferences.audioMode} audio is unavailable in this clip; using ${player.audioState.mode}. Your preference is kept for the next compatible clip.`:''));await resumeWhenReady(current);return;
 }
 if(!info.videoTracks.length){playWhenReady=false;status('No video track found in this container. Use Next to skip this clip.');return;}
 pendingFile=file;if(confirmedProjection.has(file)){loadEquirectangular();return;}$('equirect').hidden=false;status('Container inspected. If this is an already-stitched equirectangular (2:1) video, choose “View as equirectangular video”. Ordinary flat videos will appear distorted. Browser codec support is checked when loading.');
 }catch(error){if(current===generation){playWhenReady=false;status(`Cannot open this file: ${error.message}. Use Next to skip this clip.`);}}
 finally{if(current===generation){mediaOpening=false;schedulePreviews();}}
}
$('download-diagnostics').addEventListener('click',()=>{
 if(!nativePlayer)return;
 try{
  // Only the player's allowlisted technical snapshot is exported; never DOM text or the File.
  const report={reportFormat:'max-playback-diagnostics-v1',privacy:'No media, filenames, paths or audio. Created locally; not uploaded.',playback:nativePlayer.getDiagnostics()};
  const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download='max-playback-diagnostics.json';document.body.append(link);
  try{link.click();}finally{link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 }catch{status('Could not save the local diagnostics report. Playback has not been changed.');}
});
$('file').addEventListener('change',e=>{setPlaylist(e.target.files);e.target.value='';});
function loadEquirectangular(){if(!pendingFile||!renderer)return;confirmedProjection.add(pendingFile);$('equirect').hidden=true;objectURL=URL.createObjectURL(pendingFile);video.src=objectURL;video.load();status('Loading local video with the browser decoder…');}
$('equirect').addEventListener('click',loadEquirectangular);
video.addEventListener('loadeddata',()=>{if(!objectURL||video.readyState<2)return;renderer?.setSource(video);$('source').textContent='LOCAL EQUIRECTANGULAR VIDEO';$('view-title').textContent='Your point of view';$('play').disabled=false;$('seek').disabled=false;status(`Video decoded locally: ${video.videoWidth} × ${video.videoHeight}. Press Play to explore.${Math.abs(video.videoWidth/video.videoHeight-2)>.05?' Warning: this is not a 2:1 frame; verify its projection.':''}`);resumeWhenReady(generation);});
video.addEventListener('error',()=>{if(objectURL&&video.error){playWhenReady=false;$('play').disabled=true;$('seek').disabled=true;status('This browser could not decode this video. HEVC support depends on your browser, OS, and hardware. Use Next to skip this clip. No transcoding or upload was attempted.');}});
async function togglePlayback(){if($('play').disabled)return;const current=generation;pendingPlayback++;stopPreview();try{if(nativePlayer){if(nativePlayer.playing)nativePlayer.pause();else await nativePlayer.play();}else if(video.paused)await video.play();else video.pause();}catch(error){if(current===generation)status(`Playback blocked: ${error.message}`);}finally{if(current===generation){pendingPlayback--;schedulePreviews();}}}
$('play').addEventListener('click',togglePlayback);
$('canvas').addEventListener('xrtoggleplay',togglePlayback);
$('canvas').addEventListener('xrseek',event=>{
 if($('seek').disabled)return;
 try{const duration=nativePlayer?nativePlayer.duration:video.duration;
  if(!Number.isFinite(duration)||duration<=0)return;
  const target=Math.max(0,Math.min(duration,(nativePlayer?nativeTime:video.currentTime)+event.detail));
  if(nativePlayer){nativePlayer.seek(target);nativeTime=target;}else video.currentTime=target;
 }catch(error){status(`Seeking failed: ${error.message}`);}
});
for(const name of ['play','pause','ended'])video.addEventListener(name,()=>{if(name==='play')stopPreview();else schedulePreviews();if(objectURL&&!nativePlayer)$('play').textContent=video.paused?'Play':'Pause';});
video.addEventListener('ended',()=>{if(objectURL&&!nativePlayer&&video.ended)advancePlaylist(generation);});
video.addEventListener('timeupdate',()=>{if(!objectURL||nativePlayer)return;$('time').textContent=`${formatTime(video.currentTime)} / ${formatTime(video.duration)}`;$('seek').value=Number.isFinite(video.duration)&&video.duration>0?video.currentTime/video.duration*1000:0;});
$('seek').addEventListener('input',()=>{try{if(nativePlayer)nativePlayer.seek($('seek').value/1000*nativePlayer.duration);else if(Number.isFinite(video.duration))video.currentTime=$('seek').value/1000*video.duration;}catch(error){status(`Seeking failed: ${error.message}`);}});video.addEventListener('seeked',()=>renderer?.refresh());
$('muted').addEventListener('change',()=>{preferences.muted=$('muted').checked;syncAudioPreferences();});
$('volume').addEventListener('input',()=>{const value=Number($('volume').value);if(Number.isFinite(value)){preferences.volume=Math.max(0,Math.min(1,value));syncAudioPreferences();}});
$('audio-mode').addEventListener('change',()=>{const mode=$('audio-mode').value;if(!nativePlayer?.audioState?.modes.includes(mode))return;preferences.audioMode=mode;nativePlayer.setAudioMode(mode);});
$('demo').addEventListener('click',()=>{++generation;stopPreview();playlistEpoch++;playlistVersion++;playlist=[];playlistIndex=-1;playWhenReady=false;mediaOpening=false;pendingPlayback=0;playlistBrowser.close();$('viewer').classList?.remove('controls-hidden');syncPlaylist();$('playlist-select').replaceChildren();clearMedia();$('filename').textContent='Generated demo panorama';$('metadata').textContent='';status('This is a synthetic panorama for testing navigation—not GoPro footage.');});
$('reset').addEventListener('click',()=>renderer?.reset());
$('fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('viewer').requestFullscreen();}catch{status('Full screen is unavailable in this browser or embedded context.');}});
$('canvas').addEventListener('webglcontextlost',e=>{e.preventDefault();nativePlayer?.pause();video.pause();status('Graphics context lost. Reload this page to restore the viewer.');});
$('canvas').addEventListener('xrerror',e=>status(`VR unavailable: ${e.detail} Close any existing immersive session in your headset or another tab, then try Enter VR again. Desktop playback is still available.`));
$('canvas').addEventListener('rendererror',e=>status(`Video texture unavailable: ${e.detail}`));
window.addEventListener('pagehide',()=>{stopPreview();playlistEpoch++;playlist=[];++generation;playWhenReady=false;nativePlayer?.close();if(objectURL)URL.revokeObjectURL(objectURL);});
