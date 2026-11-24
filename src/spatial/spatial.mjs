import {createRenderer} from '../renderer.js';

const $ = id => document.getElementById(id);
const canvas = $('view'), vr = $('vr'), play = $('play'), size = $('size');
const isolated = globalThis.crossOriginIsolated === true;
const threads = $('threads'), multicore = $('multicore');
const views = [document.createElement('canvas'),document.createElement('canvas')];
const contexts = views.map(view => view.getContext('2d', {alpha:false}));
const BUFFER = 24, START = 10, MAX_QUEUE_BYTES = 96 * 1024 ** 2;
let renderer, worker, selected, queue, pending, done, playing, ready, ended, waiting;
let capacity, firstTime, lastTime, nextDue, sourceFPS, decoded, shown, stalls, decodeMS;

function note(message) { $('status').textContent = message; }
function metrics() {
  $('source').textContent = sourceFPS ? `${sourceFPS.toFixed(2)} fps` : '–';
  $('decode').textContent = decodeMS ? `${(1000*decoded/decodeMS).toFixed(1)} pairs/s` : '–';
  $('shown').textContent = ready ? String(shown) : '–';
  $('stalls').textContent = ready ? String(stalls) : '–';
  play.disabled = !ready;
  play.textContent = ended ? 'Replay' : playing ? 'Pause' : 'Play';
}
function stopWorker() { worker?.terminate(); worker = null; }
function fail(message) {
  stopWorker();
  queue = []; pending = ready = playing = false;
  note(message);
  metrics();
}
function fill() {
  if (!worker || done || pending || queue.length >= capacity) return;
  pending = true;
  worker.postMessage({type:'read', count:capacity-queue.length});
}
function display(pair) {
  for (let i=0; i<2; i++) {
    const view = views[i];
    if (view.width !== pair.width || view.height !== pair.height) {
      view.width = pair.width; view.height = pair.height;
    }
    contexts[i].putImageData(new ImageData(new Uint8ClampedArray(pair.eyes[i]), pair.width, pair.height), 0, 0);
  }
  renderer.setStereoFlatSources(...views);
}
function load(file, autoplay = false) {
  if (!renderer) return;
  selected = file;
  stopWorker();
  queue = [];
  capacity = 1;
  pending = done = ready = ended = waiting = false;
  playing = autoplay;
  sourceFPS = decoded = shown = stalls = decodeMS = 0;
  firstTime = lastTime = nextDue = null;
  for (const view of views) { view.width = 16; view.height = 9; }
  renderer.setStereoFlatSources(...views);
  note('Opening the MOV and decoding both eyes…');
  metrics();
  const current = worker = new Worker(new URL('./decoder-worker.mjs', import.meta.url), {type:'module'});
  current.onerror = () => { if (worker === current) fail('Could not start the spatial decoder. Try an up-to-date Chrome or Edge and reload.'); };
  current.onmessage = ({data}) => {
    if (worker !== current) return;
    if (data.type === 'opened') {
      sourceFPS = data.fps;
      fill();
    } else if (data.type === 'frames') {
      pending = false;
      done = data.ended;
      if (done) stopWorker();
      decodeMS += data.milliseconds;
      decoded += data.list.length;
      for (const pair of data.list) {
        if (!Number.isFinite(pair.time) || (lastTime !== null && pair.time <= lastTime)) {
          fail('The decoder emitted out-of-order stereo timestamps.'); return;
        }
        if (firstTime === null) {
          firstTime = pair.time;
          capacity = Math.max(1, Math.min(BUFFER, Math.floor(MAX_QUEUE_BYTES / (pair.width*pair.height*8))));
        }
        lastTime = pair.time;
        queue.push(pair);
      }
      if (!ready && queue.length) {
        ready = true;
        try { display(queue[0]); } catch (error) { fail(error.message); return; }
        note(playing ? 'Buffering both eyes…' : 'Both eyes decoded. Press Play or enter VR.');
      } else if (!ready && done) {
        fail('No stereo frames were found in this file.'); return;
      }
      fill();
    } else if (data.type === 'error') fail(data.message);
    metrics();
  };
  current.postMessage({type:'open', file, width:Number(size.value), threads:isolated ? Number(threads.value) : 1});
}
function toggle() {
  if (!ready) return;
  if (ended) { load(selected, true); return; }
  playing = !playing;
  nextDue = null;
  waiting = false;
  note(playing ? 'Playing original MOV…' : 'Paused.');
  metrics();
}
function tick() {
  if (!playing || !ready) return;
  const now = performance.now();
  if (nextDue === null) {
    if (!done && queue.length < Math.min(START, capacity)) return;
    nextDue = now;
    waiting = false;
    note('Playing original MOV…');
  }
  if (now < nextDue) return;
  if (!queue.length) {
    if (done) {
      ended = true;
      playing = false;
      note('Finished. Compare decode throughput with source cadence, and check buffer stalls.');
      metrics();
    } else if (!waiting) {
      stalls++;
      nextDue = null;
      waiting = true;
      note('Buffering both eyes…');
      metrics();
    }
    return;
  }
  const current = queue.shift();
  const step = queue.length ? 1000*(queue[0].time-current.time) : 1000/(sourceFPS || 30);
  // Keep the clock stable without bursting through stale frames in the headset.
  nextDue = Math.max(nextDue+step, now);
  try { display(current); } catch (error) { fail(error.message); return; }
  shown++;
  fill();
  if (shown%8 === 0) metrics();
}
try {
  renderer = createRenderer(canvas);
  for (const view of views) { view.width = 16; view.height = 9; }
  renderer.setStereoFlatSources(...views);
  renderer.onBeforeRender(tick);
  renderer.setDesktopMirror(true);
  renderer.onXRPanelState(() => ({playing, canPlay:ready, duration:lastTime == null ? 0 : lastTime-firstTime}));
  $('open').onclick = () => $('file').click();
  $('file').onchange = () => {
    const file = $('file').files[0];
    $('file').value = '';
    if (file) load(file);
  };
  size.onchange = threads.onchange = () => { if (selected) load(selected); };
  $('threads-row').hidden = !isolated;
  multicore.hidden = isolated || !navigator.serviceWorker;
  multicore.onclick = async () => {
    if (selected && !window.confirm('Multicore reloads this page. You will need to select your MOV again. Continue?')) return;
    try {
      multicore.disabled = true;
      note('Enabling multicore for this page…');
      await navigator.serviceWorker.register('./isolate.js');
      await navigator.serviceWorker.ready;
      location.reload();
    } catch {
      multicore.disabled = false;
      note('Could not enable multicore. Single-thread playback is still available.');
    }
  };
  play.onclick = toggle;
  $('reset').onclick = () => renderer.reset();
  $('eye').onchange = e => renderer.setStereoDesktopEye(e.target.value);
  canvas.addEventListener('xrtoggleplay', toggle);
  canvas.addEventListener('xrpanelaction', ({detail}) => { if (detail.action === 'play') toggle(); });
  canvas.addEventListener('xrerror', ({detail}) => note(detail));
  canvas.addEventListener('rendererror', ({detail}) => fail(detail));
  vr.disabled = true;
  if (navigator.xr) navigator.xr.isSessionSupported('immersive-vr').then(ok => {vr.disabled = !ok;}).catch(() => {});
  document.addEventListener('keydown', e => {
    if (e.code === 'Space' && (e.target === canvas || e.target === document.body)) {
      e.preventDefault();
      if (!e.repeat) toggle();
    }
  });
  window.addEventListener('pagehide', e => { if (!e.persisted) stopWorker(); });
} catch (error) { $('open').disabled = true; fail(error.message); }
