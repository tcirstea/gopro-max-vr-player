# Spatial Video Lab

This isolated experiment takes the original local Apple spatial MOV, decodes its
MV-HEVC track directly, matches left and right frames by presentation timestamp,
and shows each eye its own view of a single flat WebXR screen. Desktop can display
either view. There are no exports or uploads. The main player does not load these
assets. This experiment does not support audio, seeking, HDR tone mapping,
side-by-side imports, or 360° spatial projection.

Open `/src/spatial/` under the usual player URL. A single-thread WebAssembly
decoder works without cross-origin isolation. **Enable multicore** registers a
service worker scoped to this directory, then reloads the lab with the response
headers needed by WebAssembly threads. It does not cache assets or affect the
main player. The isolated page allows four threads or a single-thread comparison.
On a compatible host with isolation headers already set, no service worker is needed.

Use a sample you trust. Start playback at 960 px per eye and check decode
throughput against the source cadence. Near-real-time raw throughput may still
yield stalls if rendering and transfers are slow. Try a higher output size only
if there is headroom. Lower sizes cut upload/scaling cost; the original coded
frame size must still be decoded. Nothing is sent automatically.

To compare CPU and experimental GPU color conversion, use the same local clip,
output size and thread count for both runs. The GPU path sends compact 8-bit
4:2:0 planes to WebGL, which converts color while drawing, without the two 2D
staging canvases. Lower output resolutions still use CPU scaling before upload;
the GPU does not decode MV-HEVC. Non-8-bit-4:2:0 input uses the CPU RGBA path.
The desktop headset mirror can be turned off to isolate its rendering cost.

**Save playback diagnostics** downloads local JSON with aggregate and recent
batch timings, queue depth, underrun durations, and rendering cadence before
and after processing. The shader setting and actual output path are both in the
log. Display submit time measures CPU-side submission, not asynchronous GPU
work. The JSON has no file or device identifiers, paths, pictures, or audio.

## Corresponding sources and rebuilding

FFmpeg 7.1.5 is used under LGPL-2.1-or-later. No encoder, network protocol, GPL
component or external codec library is enabled. The bridge `decoder.c` is also
available under LGPL-2.1-or-later. [License](COPYING.LGPLv2.1.txt) ·
[exact unmodified FFmpeg source](https://github.com/FFmpeg/FFmpeg/archive/3a0867c2bfda4a4d4309ca1a8cbdc6175e67f587.tar.gz) ·
[Emscripten license](EMSCRIPTEN-LICENSE.txt) · [Emscripten SDK source](https://github.com/emscripten-core/emsdk/tree/4.0.21).

Activate Emscripten SDK 4.0.21. Use two separate clean FFmpeg checkouts to
avoid mixing libraries built with incompatible threading flags:

```sh
git clone --depth 1 --branch n7.1.5 https://github.com/FFmpeg/FFmpeg.git /tmp/spatial-ffmpeg
git clone --depth 1 --branch n7.1.5 https://github.com/FFmpeg/FFmpeg.git /tmp/spatial-ffmpeg-mt
bash src/spatial/build-decoder.sh /tmp/spatial-ffmpeg
MULTICORE=1 bash src/spatial/build-decoder.sh /tmp/spatial-ffmpeg-mt
```

The script compiles the libraries and relinks the complete bridge from source.
The generated `.mjs` files and gzipped WASM modules are replaceable; no other
objects or services are required by the build. You can modify/relink the
components and inspect or reverse-engineer the modified build for debugging.
