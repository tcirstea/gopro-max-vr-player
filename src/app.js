import {inspectFile,formatTime} from './inspect.js';
import {createRenderer,demoPanorama} from './renderer.js';
const $=id=>document.getElementById(id), video=$('video');
let renderer,objectURL=null,generation=0,pendingFile=null;
const status=message=>$('status').textContent=message;
try{renderer=createRenderer($('canvas'));renderer.setSource(demoPanorama());}catch(error){status(error.message);}
const hasHEVC=video.canPlayType('video/mp4; codecs="hvc1.1.6.L153.B0"');
$('capabilities').textContent=`This browser: WebGL ${renderer?'available':'unavailable'} · WebCodecs ${'VideoDecoder' in window?'available':'unavailable'} · HEVC media hint: ${hasHEVC||'not reported'}. These hints do not validate native MAX playback.`;
function clearMedia(){video.pause();video.removeAttribute('src');video.load();if(objectURL)URL.revokeObjectURL(objectURL);objectURL=null;pendingFile=null;$('play').disabled=true;$('seek').disabled=true;$('seek').value=0;$('time').textContent='0:00 / 0:00';$('equirect').hidden=true;renderer?.setSource(demoPanorama());$('source').textContent='DEMO PANORAMA';$('view-title').textContent='Take a look around';}
async function openFile(file){
 const current=++generation;clearMedia();$('filename').textContent=file.name;$('metadata').textContent='';status('Inspecting local container metadata…');
 try{const info=await inspectFile(file);if(current!==generation)return;
 $('metadata').textContent=`${(file.size/1024/1024).toFixed(1)} MiB · Container brand: ${info.brand||'unknown'}\n`+info.tracks.map((t,i)=>`Track ${i+1}: ${t.type} / ${t.codec}${t.width?` / ${t.width} × ${t.height}`:''}`).join('\n');
 if(info.nativeCandidate){status('Native / multi-track candidate detected. Inspection succeeded; native MAX playback is not implemented yet. The viewer remains a demo, not your footage. No file was uploaded.');return;}
 if(!info.videoTracks.length){status('No video track found in this container.');return;}
 pendingFile=file;$('equirect').hidden=false;status('Container inspected. If this is an already-stitched equirectangular (2:1) video, choose “View as equirectangular video”. Ordinary flat videos will appear distorted. Browser codec support is checked when loading.');
 }catch(error){if(current===generation)status(`Cannot inspect this file: ${error.message}`);}
}
$('file').addEventListener('change',e=>{const file=e.target.files[0];if(file)openFile(file);e.target.value='';});
$('equirect').addEventListener('click',()=>{if(!pendingFile||!renderer)return;$('equirect').hidden=true;objectURL=URL.createObjectURL(pendingFile);video.src=objectURL;video.load();status('Loading local video with the browser decoder…');});
video.addEventListener('loadeddata',()=>{if(!objectURL)return;renderer?.setSource(video);$('source').textContent='LOCAL EQUIRECTANGULAR VIDEO';$('view-title').textContent='Your point of view';$('play').disabled=false;$('seek').disabled=false;status(`Video decoded locally: ${video.videoWidth} × ${video.videoHeight}. Press Play to explore.${Math.abs(video.videoWidth/video.videoHeight-2)>.05?' Warning: this is not a 2:1 frame; verify its projection.':''}`);});
video.addEventListener('error',()=>{if(objectURL)status('This browser could not decode this video. HEVC support depends on your browser, OS, and hardware. No transcoding or upload was attempted.');});
$('play').addEventListener('click',async()=>{try{if(video.paused)await video.play();else video.pause();}catch(error){status(`Playback blocked: ${error.message}`);}});
for(const name of ['play','pause','ended'])video.addEventListener(name,()=>$('play').textContent=video.paused?'Play':'Pause');
video.addEventListener('timeupdate',()=>{$('time').textContent=`${formatTime(video.currentTime)} / ${formatTime(video.duration)}`;$('seek').value=Number.isFinite(video.duration)&&video.duration>0?video.currentTime/video.duration*1000:0;});
$('seek').addEventListener('input',()=>{if(Number.isFinite(video.duration))video.currentTime=$('seek').value/1000*video.duration;});video.addEventListener('seeked',()=>renderer?.refresh());
$('muted').addEventListener('change',()=>video.muted=$('muted').checked);
$('demo').addEventListener('click',()=>{++generation;clearMedia();renderer?.reset();$('filename').textContent='Generated demo panorama';$('metadata').textContent='';status('This is a synthetic panorama for testing navigation—not GoPro footage.');});
$('reset').addEventListener('click',()=>renderer?.reset());
$('fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('viewer').requestFullscreen();}catch{status('Full screen is unavailable in this browser or embedded context.');}});
$('canvas').addEventListener('webglcontextlost',e=>{e.preventDefault();video.pause();status('Graphics context lost. Reload this page to restore the viewer.');});
$('canvas').addEventListener('rendererror',e=>status(`Video texture unavailable: ${e.detail}`));
window.addEventListener('pagehide',()=>{if(objectURL)URL.revokeObjectURL(objectURL);});
