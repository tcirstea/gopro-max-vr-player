import {yuvLayout} from './yuv-color.mjs';

async function loadCore(threads) {
  const variant = threads > 1 ? 'decoder-mt' : 'decoder-core';
  const [{default:makeDecoder}, response] = await Promise.all([
    threads > 1 ? import('./decoder-mt.mjs?v=planar1') : import('./decoder-core.mjs?v=planar1'),
    fetch(new URL(`./${variant}.wasm.gz?v=planar1`, import.meta.url))
  ]);
  if (!response.ok || !response.body) throw new Error('Spatial decoder download failed.');
  const body = response.headers.get('Content-Encoding')?.includes('gzip')
    ? response.body : response.body.pipeThrough(new DecompressionStream('gzip'));
  const wasmBinary = new Uint8Array(await new Response(body).arrayBuffer());
  // Another decode thread can grow shared memory without refreshing this
  // worker's exported typed array. Re-read the shared buffer when copying.
  const wasmMemory = threads > 1 ? new WebAssembly.Memory({initial:256, maximum:8192, shared:true}) : undefined;
  return makeDecoder({wasmBinary, wasmMemory, mainScriptUrlOrBlob: new URL(`./${variant}.mjs?v=planar1`, import.meta.url).href});
}

let core;
function requireOK(result) {
  if (result < 0) throw new Error(core.UTF8ToString(core._sp_error()));
  return result;
}
self.onmessage = async ({data}) => {
  try {
    if (data.type === 'open' && !core) {
      core = await loadCore(data.threads);
      const {FS, WORKERFS} = core;
      FS.mkdir('/input');
      FS.mount(WORKERFS, {blobs:[{name:'local.mov', data:data.file}]}, '/input');
      requireOK(core._sp_open(data.width, data.threads, Number(data.shader)));
      const fps = core._sp_fps();
      self.postMessage({type:'opened', fps:fps > 0 ? fps : null});
    } else if (data.type === 'read' && core) {
      const started = performance.now();
      const list = [], transfer = [];
      let ended = false, copyMs = 0;
      const demux = core._sp_demux_ms(), convert = core._sp_convert_ms();
      for (let i=0; i<Math.min(6, data.count); i++) {
        if (!requireOK(core._sp_next())) { ended = true; break; }
        const width = core._sp_width(), height = core._sp_height();
        const planar = Boolean(core._sp_planar()), colors = planar ? [core._sp_color(0),core._sp_color(1)] : null;
        const bytes = planar ? yuvLayout(width,height).bytes : width*height*4;
        const copying = performance.now();
        const eyes = [0,1].map(eye => {
          const ptr = core._sp_eye(eye);
          const heap = core.wasmMemory ? new Uint8Array(core.wasmMemory.buffer) : core.HEAPU8;
          if (ptr <= 0 || ptr+bytes > heap.length) throw new Error('The decoded eye is outside decoder memory.');
          const buffer = heap.slice(ptr, ptr+bytes).buffer;
          transfer.push(buffer);
          return buffer;
        });
        copyMs += performance.now()-copying;
        list.push({time:core._sp_time(), width, height, eyes, colors});
      }
      const demuxMs = core._sp_demux_ms()-demux, convertMs = core._sp_convert_ms()-convert;
      const milliseconds = performance.now()-started;
      if (ended) core._sp_close();
      self.postMessage({type:'frames', list, ended, milliseconds,
        stages:{demuxMs,convertMs,copyMs,decodeMs:Math.max(0,milliseconds-demuxMs-convertMs-copyMs)}}, transfer);
    }
  } catch (error) {
    self.postMessage({type:'error', message:error.message});
    self.close();
  }
};
