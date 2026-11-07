import {installDesktopFullscreenControls} from './desktop-fullscreen-controls.js';
import {resolvePlaylistSeek,readPlaylistSeekDuration} from './playlist-seek.js';
import {createNextClipPreloader,prepareNextClip,shouldPreloadNext} from './next-clip-preload.js';
import {installKeyboardControls} from './keyboard-controls.js';
import {createNativePlayer} from './native-player.js';
import {inspectFile,formatTime} from './inspect.js';
import {createRenderer,demoPanorama} from './renderer.js';
import {createPlaylistEntries,sortPlaylistEntries,PLAYLIST_SORTS} from './playlist-model.js';
import {createPlaylistBrowser} from './playlist-browser.js';
import {readPlaylistMetadata,createPlaylistThumbnail} from './playlist-media.js';
const $=id=>document.getElementById(id), video=$('video');
const fullscreenControls=installDesktopFullscreenControls({document,window});
// Store only explicit gallery choices, never filenames, media or audio state.
// Missing/invalid saved values take the current default; explicit false survives.
function readGalleryPreference(name,fallback){
 try{const value=window.localStorage.getItem(`gopro-max-vr-player.gallery.${name}`);return value==='true'?true:value==='false'?false:fallback;}catch{return fallback;}
}
function saveGalleryPreference(name,value){
 try{window.localStorage.setItem(`gopro-max-vr-player.gallery.${name}`,String(value));}catch{/* Storage may be blocked; keep the choice for this session. */}
}
// Audio preferences belong to this session, not the loaded media. Unsupported
// modes must never overwrite the preferred mode.
const preferences={muted:$('muted').checked,volume:1,audioMode:'stereo',generateThumbnails:readGalleryPreference('generateThumbnails',true),doubleHeightRows:readGalleryPreference('doubleHeightRows',false)};
function syncAudioPreferences(){
 $('muted').checked=preferences.muted;$('volume').value=preferences.volume;
 video.muted=preferences.muted;video.volume=preferences.volume;
 nativePlayer?.setMuted(preferences.muted);nativePlayer?.setVolume?.(preferences.volume);
}
function syncAudioMode(state=nativePlayer?.audioState){
 $('audio-mode').hidden=false;$('audio-mode').value=preferences.audioMode;
 const message=state?.available?`Current clip: ${state.mode==='ambisonic'?'spatial headphones':state.mode+' audio'}.${state.modes.includes(preferences.audioMode)?'': ' Preferred audio type is unavailable here; it is kept for the next compatible clip.'}`:nativePlayer?'Audio is unavailable for this clip. Your audio preference is kept.':'Choose a preference for native MAX clips. Spatial headphones require supported spatial metadata; other clips use stereo when available. Browser-decoded clips use their normal audio.';
 const note=$('audio-mode-note');if(note.textContent!==message)note.textContent=message;
}
function applyNativePreferences(player){
 if(player.audioState?.modes.includes(preferences.audioMode) && player.audioState.mode!==preferences.audioMode)player.setAudioMode(preferences.audioMode);
 syncAudioPreferences();syncAudioMode(player.audioState);
}

let renderer,objectURL=null,generation=0,pendingFile=null,pendingBlob=null,nativePlayer=null,nativeTime=0,nativeAdvancing=false;
let playlist=[],playlistIndex=-1,playWhenReady=false,playlistEpoch=0,playlistVersion=0,playlistSort='added',playlistDescending=false;
let previewAbort=null,previewRunning=false,mediaOpening=false,pendingPlayback=0;
let relativeSeek=null,transportRevision=0,mediaReadyCallback=null,mediaStartTime=null;
const seekDurations=new WeakMap();
function completeMediaReady(ready){const callback=mediaReadyCallback;mediaReadyCallback=null;callback?.(ready);}
function currentPlaybackTime(){return nativePlayer?(nativePlayer.currentTime??nativeTime):video.currentTime;}
function canSeekRelative(){return !!relativeSeek||!$('seek').disabled;}
function cancelRelativeSeek(restore=false){
 const job=relativeSeek;if(!job)return;
 relativeSeek=null;job.abort.abort();completeMediaReady(false);playbackStatus('');if($('seek').disabled)$('play').disabled=true;
 if(restore){playWhenReady=job.playing;const current=generation;Promise.resolve().then(()=>{if(current===generation&&!relativeSeek&&!mediaOpening&&!$('play').disabled)resumeWhenReady(current);});}
}
function applySeek(target){
 transportRevision++;cancelPreloadForSeek(target);
 if(nativePlayer){nativePlayer.seek(target);nativeTime=target;}else video.currentTime=target;
}

const nextClipPreload=createNextClipPreloader({prepare:prepareNextClip});
let preloadResumeAfter=null,latestPlayback=null;
function updateNextPreload(state=latestPlayback){
 latestPlayback=state;
 if(preloadResumeAfter!==null&&state?.playing&&!state.buffering&&!state.preparing&&state.currentTime>=preloadResumeAfter)preloadResumeAfter=null;
 const next=playlist[playlistIndex+1];
 if(!relativeSeek&&preloadResumeAfter===null&&!document.hidden&&!mediaOpening&&next&&state&&shouldPreloadNext(state))nextClipPreload.consider(next.id,next.file);
 else nextClipPreload.cancel();
}
function cancelPreloadForSeek(target){preloadResumeAfter=Number.isFinite(target)?target+.25:Infinity;nextClipPreload.cancel();}
function playlistState(){return {items:playlist,selectedId:playlist[playlistIndex]?.id,sort:playlistSort,descending:playlistDescending,version:playlistVersion,generateThumbnails:preferences.generateThumbnails,doubleHeightRows:preferences.doubleHeightRows};}
const playlistBrowser=createPlaylistBrowser({getState:playlistState,onSelect:selectPlaylistItem,onSort:sortPlaylist,onDirection:()=>sortPlaylist(playlistSort,!playlistDescending)});
function stopPreview(){previewAbort?.abort();}
function isPlaying(){return !!(nativePlayer?.playing||(!video.paused&&objectURL));}
function schedulePreviews(){
 if(relativeSeek||previewRunning||mediaOpening||pendingPlayback>0||isPlaying()||!playlist.length)return;
 const epoch=playlistEpoch;
 previewRunning=true;previewAbort=new AbortController();const signal=previewAbort.signal;
 (async()=>{
  try{for(const item of playlist.slice()){
   if(signal.aborted||epoch!==playlistEpoch||isPlaying()||mediaOpening)break;
   if(item.thumbnailDone||!item.metadataDone)continue;
   let thumbnail=null;try{thumbnail=await createPlaylistThumbnail(item.file,{signal,generate:preferences.generateThumbnails,metadata:item});}catch{}
   if(signal.aborted||epoch!==playlistEpoch)break;
   item.thumbnail=thumbnail;item.thumbnailSource=thumbnail?.thumbnailSource||(thumbnail?'Generated frame':null);item.thumbnailDone=true;playlistVersion++;playlistBrowser.render();
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
 cancelRelativeSeek(true);transportRevision++;
 const selected=playlist[playlistIndex]?.id;playlistSort=key;playlistDescending=!!descending;
 playlist=sortPlaylistEntries(playlist,key,playlistDescending);
 playlistIndex=playlist.findIndex(item=>item.id===selected);playlistVersion++;syncPlaylist();updateNextPreload();
}
function selectPlaylistItem(id){
 const index=playlist.findIndex(item=>item.id===id);if(index<0)return;
 playlistBrowser.close();renderer?.hideXRControls?.();$('viewer').classList?.add('controls-hidden');$('canvas').focus?.();fullscreenControls.hide();
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
 cancelRelativeSeek();stopPreview();playlistEpoch++;playlistVersion++;playlist=createPlaylistEntries(files,playlistEpoch);playlistIndex=-1;
 playlist=sortPlaylistEntries(playlist,playlistSort,playlistDescending);
 const opened=selectClip(0,false);enrichPlaylist(playlistEpoch);return opened;
}
function selectClip(index,autoplay=relativeSeek?.playing||nativePlayer?.playing||(!video.paused&&!!objectURL)||playWhenReady,automatic=false,seekOptions=null){
 if(!Number.isInteger(index)||index<0||index>=playlist.length)return;
 if(!seekOptions)cancelRelativeSeek();transportRevision++;
 const item=playlist[index],prepared=automatic?nextClipPreload.take(item.id,item.file):null;
 if(!automatic)nextClipPreload.cancel();
 playlistIndex=index;playWhenReady=!!autoplay;syncPlaylist();
 return openFile(item.file,{prepared,preserveFrame:automatic||!!seekOptions,...seekOptions});
}
function advancePlaylist(current){
 // Run outside a decoder callback: closing its player synchronously would
 // otherwise invalidate the frames that the callback is still presenting.
 const revision=transportRevision;
 Promise.resolve().then(()=>{if(!relativeSeek&&revision===transportRevision&&current===generation&&playlistIndex>=0&&playlistIndex<playlist.length-1)selectClip(playlistIndex+1,true,true);});
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
for(const type of ['pointerdown','keydown'])$('canvas').addEventListener(type,()=>{$('viewer').classList?.remove('controls-hidden');fullscreenControls.reveal();});
syncPlaylist();
const status=message=>$('status').textContent=message;
let viewHelpFlat=null;
function syncViewHelp(flat=false){
 if(viewHelpFlat===flat)return;viewHelpFlat=flat;
 $('view-mode').textContent=flat?'2D':'360°';$('viewer').setAttribute?.('aria-label',flat?'Flat video viewer':'360 degree viewer');
 $('canvas').setAttribute?.('aria-label',flat?'Flat video. Space plays or pauses. Left and right arrows seek five seconds. Scroll or plus and minus zoom. Middle click resets zoom. Rotation is disabled.':'360 panorama. Drag to look around, right-drag to roll, scroll to zoom. Space plays or pauses. Left and right arrows seek.');
 $('view-help').textContent=flat?'Flat video · Scroll to zoom · Middle-click resets zoom · Space plays/pauses · ←/→ seek':'Left-drag to pan · Right-drag horizontally to roll · Scroll to zoom · Middle-click resets zoom · Space plays/pauses · ←/→ seek';
}

function playbackStatus(message){const element=$('playback-state');if(element.textContent!==message)element.textContent=message;element.hidden=!message;}
try{renderer=createRenderer($('canvas'));renderer.setSource(demoPanorama());renderer.onBeforeRender?.(time=>nativePlayer?.advance(time));renderer.onViewOrientation?.(rotation=>nativePlayer?.setViewRotation(rotation));}catch(error){status(error.message);}
// Explicit, session-only opt-in: never restore sharing a headset view on reload.
$('desktop-mirror').checked=false;
$('desktop-mirror').disabled=!renderer;
$('desktop-mirror').addEventListener('change',()=>renderer?.setDesktopMirror?.($('desktop-mirror').checked));
$('desktop-mirror-quality').value='performance';
$('desktop-mirror-quality').disabled=!renderer;
$('desktop-mirror-quality').addEventListener('change',()=>renderer?.setDesktopMirrorQuality?.($('desktop-mirror-quality').value));
$('canvas').addEventListener('xrmirrorchange',event=>{
 $('desktop-mirror').checked=event.detail.enabled;
 if(event.detail.quality)$('desktop-mirror-quality').value=event.detail.quality;
 $('viewer').classList?.toggle('xr-mirror-active',event.detail.active);
});
$('canvas').addEventListener('xrmirrorerror',event=>status(event.detail));
// Read live transport state each XR frame; buffering must not consume the
// panel's two seconds of actual playback. The provider also works in demo mode.
renderer?.onXRPanelState?.(()=>({
 mediaId:generation,playing:relativeSeek?relativeSeek.playing:nativePlayer?nativePlayer.playing:!!objectURL&&!video.paused&&!video.ended,
 advancing:!relativeSeek&&(nativePlayer?nativeAdvancing:!!objectURL&&!video.paused&&!video.ended&&!video.seeking&&video.readyState>=3),
 currentTime:nativePlayer?nativeTime:video.currentTime,duration:nativePlayer?nativePlayer.duration:video.duration,
 canPlay:!!relativeSeek||!$('play').disabled,canSeek:!$('seek').disabled,canMute:!$('muted').disabled,muted:preferences.muted,
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
  try{cancelRelativeSeek(true);applySeek(target);}
  catch(error){status(`Seeking failed: ${error.message}`);}
 }
});
const hasHEVC=video.canPlayType('video/mp4; codecs="hvc1.1.6.L153.B0"');
$('capabilities').textContent=`This browser: WebGL ${renderer?'available':'unavailable'} · WebCodecs ${'VideoDecoder' in window?'available':'unavailable'} · HEVC media hint: ${hasHEVC||'not reported'}. These hints do not validate native MAX playback.`;
function clearMedia({preserveFrame=false}={}){nativeTime=0;nativeAdvancing=false;nativePlayer?.close();nativePlayer=null;$('diagnostics-panel').hidden=true;playbackStatus('');$('play').textContent=relativeSeek?.playing?'Pause':'Play';$('muted').disabled=false;syncAudioMode();syncAudioPreferences();video.pause();video.removeAttribute('src');video.load();if(objectURL)URL.revokeObjectURL(objectURL);objectURL=null;pendingFile=null;pendingBlob=null;$('play').disabled=!relativeSeek;$('seek').disabled=true;$('seek').value=0;$('time').textContent='0:00 / 0:00';if(!preserveFrame){renderer?.setSource(demoPanorama());$('source').textContent='DEMO PANORAMA';$('view-title').textContent='Take a look around';syncViewHelp();}}
async function openFile(file,{prepared=null,preserveFrame=false,initialTime=null,onReady=null,onBrowserPending=null}={}){
 completeMediaReady(false);mediaStartTime=initialTime;mediaReadyCallback=onReady;
 nextClipPreload.cancel();preloadResumeAfter=null;latestPlayback=null;stopPreview();mediaOpening=true;pendingPlayback=0;const current=++generation;let ended=false;clearMedia({preserveFrame});$('filename').textContent=file.name;$('metadata').textContent='';status('Inspecting local container metadata…');
 try{const info=prepared?.info||await inspectFile(file,{allowBrowser:true});if(current!==generation)return;
 $('metadata').textContent=info.browserFallback?`${(file.size/1024/1024).toFixed(1)} MiB · Container and codecs checked by the browser.`:`${(file.size/1024/1024).toFixed(1)} MiB · Container brand: ${info.brand||'unknown'}\n`+info.tracks.map((t,i)=>`Track ${i+1}: ${t.type} / ${t.codec}${t.width?` / ${t.width} × ${t.height}`:''}`).join('\n');
 if(info.nativeCandidate){
  if(!renderer)throw new Error('WebGL is required for native playback.');
  status('Native dual-track candidate detected. Checking HEVC decoders and loading paired frames locally…');
  const preparedMovie=prepared?.movie;prepared=null;
  const player=await createNativePlayer(file,{autoTick:false,preparedMovie,initialTime:initialTime??0,
   onFrames(a,b,options){if(current!==generation)return;renderer.setMaxSources(a,b,options);$('source').textContent='LOCAL MAX · EXPERIMENTAL EAC';$('view-title').textContent='Your point of view';syncViewHelp();},
   onState(state){if(current!==generation)return;nativeTime=state.currentTime;nativeAdvancing=state.playing&&!state.buffering&&!state.preparing;playbackStatus(relativeSeek?'Seeking across the playlist…':state.preparing?(state.inputStrategy==='chunked-prefetch'?'Preparing 64 MiB playback buffers in local memory…':'Preparing this short clip in local memory…'):state.buffering?'Buffering paired video frames… Playback time is held until frames are ready.':state.playing?`Playing locally · ${state.audio?.available?(state.audio.mode==='ambisonic'?'Head-relative ambisonic headphones':state.audio.mode+' audio'):'Audio unavailable on this browser'}.`:'');$('play').textContent=(relativeSeek?relativeSeek.playing:state.playing)?'Pause':'Play';if(state.playing)stopPreview();else schedulePreviews();if(state.currentTime<state.duration)updateNextPreload(state);$('time').textContent=`${formatTime(state.currentTime)} / ${formatTime(state.duration)}`;$('seek').value=state.currentTime/state.duration*1000;if(state.audio){$('muted').disabled=!state.audio.available;syncAudioMode(state.audio);}if(state.currentTime<state.duration)ended=false;if(!relativeSeek&&!state.playing&&state.duration>0&&state.currentTime>=state.duration&&!ended){ended=true;advancePlaylist(current);}},
   onError(error){if(current===generation){completeMediaReady(false);playbackStatus('');$('play').disabled=true;$('seek').disabled=true;playWhenReady=false;latestPlayback=null;nextClipPreload.cancel();status(`Native decoder stopped: ${error.message}. Use Next to skip this clip.`);}}
  });
  if(current!==generation){player.close();return;}nativePlayer=player;seekDurations.set(file,player.duration);$('diagnostics-panel').hidden=false;$('play').disabled=false;$('seek').disabled=false;applyNativePreferences(player);$('muted').disabled=!player.audioState?.available;syncAudioMode(player.audioState);
  status('Experimental native MAX pipeline opened locally. Press Play. Dual HEVC frames are mapped as EAC; overlap blending is included; native audio is synchronized when supported. Your audio preferences are retained; headphone mode uses verified spatial metadata. Optical-flow seam correction is not implemented. Codec support does not guarantee real-time playback.'+(player.audioState?.available&&!player.audioState.modes.includes(preferences.audioMode)?` Preferred ${preferences.audioMode} audio is unavailable in this clip; using ${player.audioState.mode}. Your preference is kept for the next compatible clip.`:''));completeMediaReady(true);await resumeWhenReady(current);return;
 }
 if(!info.browserFallback&&!info.videoTracks.length){completeMediaReady(false);playWhenReady=false;status('No video track found in this container. Use Next to skip this clip.');return;}
 pendingFile=file;pendingBlob=prepared?.blob||null;loadBrowserVideo();onBrowserPending?.();
 }catch(error){if(current===generation){completeMediaReady(false);playWhenReady=false;status(`Cannot open this file: ${error.message}. Use Next to skip this clip.`);}}
 finally{prepared?.close();if(current===generation){mediaOpening=false;schedulePreviews();if(latestPlayback)updateNextPreload();}}
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
function syncBrowserVideo(){
 if(video.readyState>=2)renderer?.setSource(video,{projection:'flat'});
 $('source').textContent='LOCAL FLAT VIDEO';$('view-title').textContent='Your video';syncViewHelp(true);
}
function loadBrowserVideo(){
 if(!pendingFile)return;
 if(!renderer)throw new Error('WebGL is required for video playback in this viewer.');
 syncBrowserVideo();objectURL=URL.createObjectURL(pendingBlob||pendingFile);pendingBlob=null;
 video.src=objectURL;video.load();status('Loading local video with the browser decoder…');
}
function applyMediaStart(){if(mediaStartTime!==null&&Number.isFinite(video.duration)){video.currentTime=Math.max(0,Math.min(video.duration,mediaStartTime));mediaStartTime=null;}}
video.addEventListener('loadedmetadata',()=>{if(objectURL){try{applyMediaStart();}catch(error){completeMediaReady(false);status(`Seeking failed: ${error.message}`);}}});
video.addEventListener('loadeddata',()=>{if(!objectURL||video.readyState<2||(video.currentSrc&&video.currentSrc!==objectURL))return;if(video.videoWidth===0||video.videoHeight===0){completeMediaReady(false);playWhenReady=false;status('No playable video picture found in this file. Use Next to skip this clip.');return;}try{applyMediaStart();}catch(error){completeMediaReady(false);status(`Seeking failed: ${error.message}`);return;}if(pendingFile&&Number.isFinite(video.duration))seekDurations.set(pendingFile,video.duration);syncBrowserVideo();$('play').disabled=false;$('seek').disabled=false;status(`Video decoded locally: ${video.videoWidth} × ${video.videoHeight}. Flat 2D playback. Browser-video 360 projections are not supported.`);completeMediaReady(true);resumeWhenReady(generation);});
video.addEventListener('error',()=>{if(objectURL&&video.error){completeMediaReady(false);playWhenReady=false;latestPlayback=null;nextClipPreload.cancel();$('play').disabled=true;$('seek').disabled=true;status('This browser could not decode this video. Container and codec support depend on your browser, OS, and hardware (including HEVC). Use Next to skip this clip. No transcoding or upload was attempted.');}});
async function togglePlayback(){if(relativeSeek){relativeSeek.playing=!relativeSeek.playing;$('play').textContent=relativeSeek.playing?'Pause':'Play';return;}if($('play').disabled)return;const current=generation;pendingPlayback++;stopPreview();try{if(nativePlayer){if(nativePlayer.playing)nativePlayer.pause();else await nativePlayer.play();}else if(video.paused)await video.play();else video.pause();}catch(error){if(current===generation)status(`Playback blocked: ${error.message}`);}finally{if(current===generation){pendingPlayback--;schedulePreviews();}}}
$('play').addEventListener('click',togglePlayback);
$('canvas').addEventListener('xrtoggleplay',togglePlayback);
$('canvas').addEventListener('xrseek',event=>seekRelative(event.detail));
installKeyboardControls({target:window,document,togglePlayback,seek:seekRelative,
 canPlay:()=>!!relativeSeek||!$('play').disabled,canSeek:canSeekRelative,
 revealControls:()=>{$('viewer').classList?.remove('controls-hidden');fullscreenControls.reveal();}
});
function seekRelative(seconds){
 if(!canSeekRelative()||!Number.isFinite(seconds)||seconds===0)return;
 if(relativeSeek){relativeSeek.delta+=seconds;relativeSeek.revision++;if(pendingFile&&$('seek').disabled)relativeSeek.wake?.();return relativeSeek.promise;}
 try{
  const duration=nativePlayer?nativePlayer.duration:video.duration,time=currentPlaybackTime();
  if(!Number.isFinite(duration)||duration<0||!Number.isFinite(time))return;
  const target=time+seconds;
  if(playlistIndex<0||(target>=0&&(target<duration||playlistIndex===playlist.length-1))||(target<0&&playlistIndex===0)){
   applySeek(Math.max(0,Math.min(duration,target)));return;
  }
  const job={items:playlist.slice(),index:playlistIndex,time,delta:seconds,revision:0,playing:isPlaying()||playWhenReady||pendingPlayback>0,abort:new AbortController()};
  seekDurations.set(job.items[job.index].file,duration);relativeSeek=job;transportRevision++;playWhenReady=false;
  cancelPreloadForSeek();stopPreview();if(nativePlayer)nativePlayer.pause();else video.pause();
  $('play').textContent=job.playing?'Pause':'Play';status('Seeking across the playlist… Reading local clip durations.');
  job.promise=runRelativeSeek(job);return job.promise;
 }catch(error){status(`Seeking failed: ${error.message}`);}
}
async function runRelativeSeek(job){
 const active=()=>relativeSeek===job&&!job.abort.signal.aborted;
 const durationFor=async item=>{
  if(!seekDurations.has(item.file))seekDurations.set(item.file,await readPlaylistSeekDuration(item.file,{signal:job.abort.signal}));
  return seekDurations.get(item.file);
 };
 const openTarget=(index,time)=>new Promise(resolve=>{
  let finished=false;const revision=job.revision;
  const done=value=>{if(finished)return;finished=true;job.wake=null;resolve(value);};
  // New seek input may abandon a browser clip while its decoder is loading.
  job.wake=()=>{mediaReadyCallback=null;done('replan');};
  selectClip(index,false,false,{initialTime:time,onReady:done,onBrowserPending:()=>{if(active()&&revision!==job.revision)job.wake?.();}});
 });
 try{
  while(active()){
   const revision=job.revision;
   const target=await resolvePlaylistSeek(job.items,job.index,job.time+job.delta,{getDuration:durationFor,signal:job.abort.signal});
   if(!active())return;if(revision!==job.revision)continue;
   if(playlist[playlistIndex]?.id!==job.items[target.index].id||$('seek').disabled){
    const opened=await openTarget(target.index,target.time);if(opened==='replan')continue;
    if(!opened){if(active())throw new Error('The destination clip could not be opened.');return;}
    if(!active())return;
    // Duration from the opened decoder is authoritative. Re-resolve if it
    // differs or more held-stick/key input arrived while the file opened.
    if(revision!==job.revision||seekDurations.get(job.items[target.index].file)!==target.duration)continue;
   }
   if(Math.abs(currentPlaybackTime()-target.time)>.000001)applySeek(target.time);
   else cancelPreloadForSeek(target.time);
   relativeSeek=null;playWhenReady=job.playing;playbackStatus('');status(`Seeked to ${formatTime(target.time)} in clip ${target.index+1} of ${job.items.length}.`);
   await resumeWhenReady(generation);schedulePreviews();return;
  }
 }catch(error){
  if(!active())return;
  // A failed duration read never leaves the current video. If opening the
  // destination fails, try to return to the original position instead.
  if(playlist[playlistIndex]?.id!==job.items[job.index].id){
   const restored=await openTarget(job.index,job.time);if(!active())return;
   if(!restored){relativeSeek=null;playWhenReady=false;status(`Seeking failed: ${error.message} Use Previous or Next to choose a playable clip.`);return;}
  }
  if(!active())return;relativeSeek=null;playWhenReady=job.playing;const current=generation;
  await resumeWhenReady(current);
  if(current===generation&&!relativeSeek)status(`Seeking failed: ${error.message} Kept the original position; use Previous or Next to choose a clip.`);
  schedulePreviews();
 }
}
for(const name of ['play','pause','ended'])video.addEventListener(name,()=>{if(name==='play')stopPreview();else schedulePreviews();if(name==='pause'&&!video.ended&&!nativePlayer){nextClipPreload.cancel();if(latestPlayback)latestPlayback={...latestPlayback,playing:false};}if(objectURL&&!nativePlayer)$('play').textContent=(relativeSeek?relativeSeek.playing:!video.paused)?'Pause':'Play';});
video.addEventListener('seeking',()=>{if(objectURL&&!nativePlayer)cancelPreloadForSeek(video.currentTime);});
for(const name of ['waiting','stalled'])video.addEventListener(name,()=>{if(objectURL&&!nativePlayer){nextClipPreload.cancel();if(latestPlayback)latestPlayback={...latestPlayback,buffering:true};}});
document.addEventListener?.('visibilitychange',()=>{if(document.hidden)nextClipPreload.cancel();else updateNextPreload();});
video.addEventListener('ended',()=>{if(objectURL&&!nativePlayer&&video.ended)advancePlaylist(generation);});
video.addEventListener('timeupdate',()=>{if(!objectURL||nativePlayer)return;if(!video.ended)updateNextPreload({playing:!video.paused,buffering:video.readyState<3||video.seeking,currentTime:video.currentTime,duration:video.duration});$('time').textContent=`${formatTime(video.currentTime)} / ${formatTime(video.duration)}`;$('seek').value=Number.isFinite(video.duration)&&video.duration>0?video.currentTime/video.duration*1000:0;});
$('seek').addEventListener('input',()=>{try{cancelRelativeSeek(true);const duration=nativePlayer?nativePlayer.duration:video.duration;if(!Number.isFinite(duration))return;const target=$('seek').value/1000*duration;applySeek(target);}catch(error){status(`Seeking failed: ${error.message}`);}});video.addEventListener('seeked',()=>renderer?.refresh());
$('muted').addEventListener('change',()=>{preferences.muted=$('muted').checked;syncAudioPreferences();});
$('volume').addEventListener('input',()=>{const value=Number($('volume').value);if(Number.isFinite(value)){preferences.volume=Math.max(0,Math.min(1,value));syncAudioPreferences();}});
$('audio-mode').addEventListener('change',()=>{const mode=$('audio-mode').value;if(!['stereo','ambisonic'].includes(mode))return;preferences.audioMode=mode;if(nativePlayer?.audioState?.modes.includes(mode))nativePlayer.setAudioMode(mode);syncAudioMode();});
$('generate-thumbnails').checked=preferences.generateThumbnails;
$('generate-thumbnails').addEventListener('change',()=>{
 preferences.generateThumbnails=$('generate-thumbnails').checked;saveGalleryPreference('generateThumbnails',preferences.generateThumbnails);stopPreview();
 if(preferences.generateThumbnails)for(const item of playlist)if(!item.thumbnail)item.thumbnailDone=false;
 playlistVersion++;playlistBrowser.render();schedulePreviews();
});
$('double-height-rows').checked=preferences.doubleHeightRows;
$('double-height-rows').addEventListener('change',()=>{
 preferences.doubleHeightRows=$('double-height-rows').checked;saveGalleryPreference('doubleHeightRows',preferences.doubleHeightRows);
 playlistVersion++;playlistBrowser.render();
});
syncAudioMode();
$('demo').addEventListener('click',()=>{cancelRelativeSeek();completeMediaReady(false);nextClipPreload.cancel();latestPlayback=null;++generation;stopPreview();playlistEpoch++;playlistVersion++;playlist=[];playlistIndex=-1;playWhenReady=false;mediaOpening=false;pendingPlayback=0;playlistBrowser.close();$('viewer').classList?.remove('controls-hidden');syncPlaylist();$('playlist-select').replaceChildren();clearMedia();$('filename').textContent='Generated demo panorama';$('metadata').textContent='';status('This is a synthetic panorama for testing navigation—not GoPro footage.');});
$('reset').addEventListener('click',()=>renderer?.reset());
$('fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('viewer').requestFullscreen();}catch{status('Full screen is unavailable in this browser or embedded context.');}});
$('canvas').addEventListener('webglcontextlost',e=>{e.preventDefault();cancelRelativeSeek();playWhenReady=false;nextClipPreload.cancel();nativePlayer?.pause();video.pause();status('Graphics context lost. Reload this page to restore the viewer.');});
$('canvas').addEventListener('xrerror',e=>status(`VR unavailable: ${e.detail} Close any existing immersive session in your headset or another tab, then try Enter VR again. Desktop playback is still available.`));
$('canvas').addEventListener('rendererror',e=>status(`Video texture unavailable: ${e.detail}`));
window.addEventListener('pagehide',()=>{cancelRelativeSeek();completeMediaReady(false);nextClipPreload.close();stopPreview();playlistEpoch++;playlist=[];++generation;playWhenReady=false;nativePlayer?.close();if(objectURL)URL.revokeObjectURL(objectURL);});
