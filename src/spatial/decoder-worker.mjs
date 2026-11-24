async function loadCore(threads) {
  const variant = threads > 1 ? 'decoder-mt' : 'decoder-core';
  const [{default:makeDecoder}, response] = await Promise.all([
    threads > 1 ? import('./decoder-mt.mjs') : import('./decoder-core.mjs'),
    fetch(new URL(`./${variant}.wasm.gz`, import.meta.url))
  ]);
  if (!response.ok || !response.body) throw new Error('Spatial decoder download failed.');
  const body = response.headers.get('Content-Encoding')?.includes('gzip')
    ? response.body : response.body.pipeThrough(new DecompressionStream('gzip'));
  const wasmBinary = new Uint8Array(await new Response(body).arrayBuffer());
  // Another decode thread can grow shared memory without refreshing this
  // worker's exported typed array. Re-read the shared buffer when copying.
  const wasmMemory = threads > 1 ? new WebAssembly.Memory({initial:256, maximum:8192, shared:true}) : undefined;
  return makeDecoder({wasmBinary, wasmMemory});
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
      requireOK(core._sp_open(data.width, data.threads));
      const fps = core._sp_fps();
      self.postMessage({type:'opened', fps:fps > 0 ? fps : null});
    } else if (data.type === 'read' && core) {
      const started = performance.now();
      const list = [], transfer = [];
      let ended = false;
      for (let i=0; i<Math.min(6, data.count); i++) {
        if (!requireOK(core._sp_next())) { ended = true; core._sp_close(); break; }
        const width = core._sp_width(), height = core._sp_height();
        const eyes = [0,1].map(eye => {
          const ptr = core._sp_eye(eye);
          const bytes = width*height*4;
          const heap = core.wasmMemory ? new Uint8Array(core.wasmMemory.buffer) : core.HEAPU8;
          if (ptr <= 0 || ptr+bytes > heap.length) throw new Error('The decoded eye is outside decoder memory.');
          const buffer = heap.slice(ptr, ptr+bytes).buffer;
          transfer.push(buffer);
          return buffer;
        });
        list.push({time:core._sp_time(), width, height, eyes});
      }
      self.postMessage({type:'frames', list, ended, milliseconds:performance.now()-started}, transfer);
    }
  } catch (error) {
    self.postMessage({type:'error', message:error.message});
    self.close();
  }
};
