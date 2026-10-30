import {createNativePlayer} from './native-player.js';
import {inspectFile,formatTime} from './inspect.js';
import {createRenderer,demoPanorama} from './renderer.js';
const $=id=>document.getElementById(id), video=$('video');
let renderer,objectURL=null,generation=0,pendingFile=null,nativePlayer=null,nativeTime=0;
const status=message=>$('status').textContent=message;
function playbackStatus(message){const element=$('playback-state');if(element.textContent!==message)element.textContent=message;element.hidden=!message;}
try{renderer=createRenderer($('canvas'));renderer.setSource(demoPanorama());renderer.onBeforeRender?.(time=>nativePlayer?.advance(time));renderer.onViewOrientation?.(rotation=>nativePlayer?.setViewRotation(rotation));}catch(error){status(error.message);}
const hasHEVC=video.canPlayType('video/mp4; codecs="hvc1.1.6.L153.B0"');
$('capabilities').textContent=`This browser: WebGL ${renderer?'available':'unavailable'} · WebCodecs ${'VideoDecoder' in window?'available':'unavailable'} · HEVC media hint: ${hasHEVC||'not reported'}. These hints do not validate native MAX playback.`;
function clearMedia(){nativeTime=0;nativePlayer?.close();nativePlayer=null;$('diagnostics-panel').hidden=true;playbackStatus('');$('play').textContent='Play';$('muted').disabled=false;$('audio-mode').hidden=true;video.muted=$('muted').checked;video.pause();video.removeAttribute('src');video.load();if(objectURL)URL.revokeObjectURL(objectURL);objectURL=null;pendingFile=null;$('play').disabled=true;$('seek').disabled=true;$('seek').value=0;$('time').textContent='0:00 / 0:00';$('equirect').hidden=true;renderer?.setSource(demoPanorama());$('source').textContent='DEMO PANORAMA';$('view-title').textContent='Take a look around';}
async function openFile(file){
 const current=++generation;clearMedia();$('filename').textContent=file.name;$('metadata').textContent='';status('Inspecting local container metadata…');
 try{const info=await inspectFile(file);if(current!==generation)return;
 $('metadata').textContent=`${(file.size/1024/1024).toFixed(1)} MiB · Container brand: ${info.brand||'unknown'}\n`+info.tracks.map((t,i)=>`Track ${i+1}: ${t.type} / ${t.codec}${t.width?` / ${t.width} × ${t.height}`:''}`).join('\n');
 if(info.nativeCandidate){
  if(!renderer)throw new Error('WebGL is required for native playback.');
  status('Native dual-track candidate detected. Checking HEVC decoders and loading paired frames locally…');
  const player=await createNativePlayer(file,{autoTick:false,
   onFrames(a,b,options){if(current!==generation)return;renderer.setMaxSources(a,b,options);$('source').textContent='LOCAL MAX · EXPERIMENTAL EAC';$('view-title').textContent='Your point of view';},
   onState(state){if(current!==generation)return;nativeTime=state.currentTime;playbackStatus(state.preparing?(state.inputStrategy==='chunked-prefetch'?'Preparing 64 MiB playback buffers in local memory…':'Preparing this short clip in local memory…'):state.buffering?'Buffering paired video frames… Playback time is held until frames are ready.':state.playing?`Playing locally · ${state.audio?.available?(state.audio.mode==='ambisonic'?'Head-relative ambisonic headphones':state.audio.mode+' audio'):'Audio unavailable on this browser'}.`:'');$('play').textContent=state.playing?'Pause':'Play';$('time').textContent=`${formatTime(state.currentTime)} / ${formatTime(state.duration)}`;$('seek').value=state.currentTime/state.duration*1000;if(state.audio){$('muted').disabled=!state.audio.available;$('audio-mode').hidden=state.audio.modes.length<2;$('audio-mode').value=state.audio.mode;}},
   onError(error){if(current===generation){playbackStatus('');$('play').disabled=true;$('seek').disabled=true;status(`Native decoder stopped: ${error.message}`);}}
  });
  if(current!==generation){player.close();return;}nativePlayer=player;$('diagnostics-panel').hidden=false;$('play').disabled=false;$('seek').disabled=false;$('muted').checked=true;video.muted=true;$('muted').disabled=!player.audioState?.available;$('audio-mode').hidden=(player.audioState?.modes.length||0)<2;$('audio-mode').value=player.audioState?.mode||'stereo';
  status('Experimental native MAX pipeline opened locally. Press Play. Dual HEVC frames are mapped as EAC; overlap blending is included; native audio is synchronized when supported. Uncheck Muted to listen; headphone mode uses verified spatial metadata. Optical-flow seam correction is not implemented. Codec support does not guarantee real-time playback.');return;
 }
 if(!info.videoTracks.length){status('No video track found in this container.');return;}
 pendingFile=file;$('equirect').hidden=false;status('Container inspected. If this is an already-stitched equirectangular (2:1) video, choose “View as equirectangular video”. Ordinary flat videos will appear distorted. Browser codec support is checked when loading.');
 }catch(error){if(current===generation)status(`Cannot open this file: ${error.message}`);}
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
$('file').addEventListener('change',e=>{const file=e.target.files[0];if(file)openFile(file);e.target.value='';});
$('equirect').addEventListener('click',()=>{if(!pendingFile||!renderer)return;$('equirect').hidden=true;objectURL=URL.createObjectURL(pendingFile);video.src=objectURL;video.load();status('Loading local video with the browser decoder…');});
video.addEventListener('loadeddata',()=>{if(!objectURL)return;renderer?.setSource(video);$('source').textContent='LOCAL EQUIRECTANGULAR VIDEO';$('view-title').textContent='Your point of view';$('play').disabled=false;$('seek').disabled=false;status(`Video decoded locally: ${video.videoWidth} × ${video.videoHeight}. Press Play to explore.${Math.abs(video.videoWidth/video.videoHeight-2)>.05?' Warning: this is not a 2:1 frame; verify its projection.':''}`);});
video.addEventListener('error',()=>{if(objectURL)status('This browser could not decode this video. HEVC support depends on your browser, OS, and hardware. No transcoding or upload was attempted.');});
async function togglePlayback(){if($('play').disabled)return;try{if(nativePlayer){if(nativePlayer.playing)nativePlayer.pause();else await nativePlayer.play();}else if(video.paused)await video.play();else video.pause();}catch(error){status(`Playback blocked: ${error.message}`);}}
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
for(const name of ['play','pause','ended'])video.addEventListener(name,()=>{if(objectURL&&!nativePlayer)$('play').textContent=video.paused?'Play':'Pause';});
video.addEventListener('timeupdate',()=>{if(!objectURL||nativePlayer)return;$('time').textContent=`${formatTime(video.currentTime)} / ${formatTime(video.duration)}`;$('seek').value=Number.isFinite(video.duration)&&video.duration>0?video.currentTime/video.duration*1000:0;});
$('seek').addEventListener('input',()=>{try{if(nativePlayer)nativePlayer.seek($('seek').value/1000*nativePlayer.duration);else if(Number.isFinite(video.duration))video.currentTime=$('seek').value/1000*video.duration;}catch(error){status(`Seeking failed: ${error.message}`);}});video.addEventListener('seeked',()=>renderer?.refresh());
$('muted').addEventListener('change',()=>{video.muted=$('muted').checked;nativePlayer?.setMuted($('muted').checked);});
$('audio-mode').addEventListener('change',()=>nativePlayer?.setAudioMode($('audio-mode').value));
$('demo').addEventListener('click',()=>{++generation;clearMedia();renderer?.reset();$('filename').textContent='Generated demo panorama';$('metadata').textContent='';status('This is a synthetic panorama for testing navigation—not GoPro footage.');});
$('reset').addEventListener('click',()=>renderer?.reset());
$('fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('viewer').requestFullscreen();}catch{status('Full screen is unavailable in this browser or embedded context.');}});
$('canvas').addEventListener('webglcontextlost',e=>{e.preventDefault();nativePlayer?.pause();video.pause();status('Graphics context lost. Reload this page to restore the viewer.');});
$('canvas').addEventListener('xrerror',e=>status(`VR unavailable: ${e.detail} Close any existing immersive session in your headset or another tab, then try Enter VR again. Desktop playback is still available.`));
$('canvas').addEventListener('rendererror',e=>status(`Video texture unavailable: ${e.detail}`));
window.addEventListener('pagehide',()=>{nativePlayer?.close();if(objectURL)URL.revokeObjectURL(objectURL);});
