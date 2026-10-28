# 360° GoPro VR player — experimental prototype

A static, local-first player targeting original **GoPro MAX** `.360` files without an export step.

**An experimental native playback pipeline is implemented, but real browser/HEVC/GPU and headset playback are not yet verified.** Parsing and projection are covered by automated unit tests. These checks do not establish end-to-end browser compatibility. This independent project is not affiliated with GoPro.

## Implemented

- Local file selection; **no video uploads**, backend, runtime CDN or npm dependencies.
- Bounded MP4 inspection and a dedicated sample-table demuxer that prepares files up to 64 MiB once in shared local memory; larger recordings use shared **64 MiB chunks with asynchronous lookahead**, bounded to 256 MiB of compressed cache plus in-flight reads.
- Two WebCodecs HEVC decoders, actual-codec capability checks, timestamp pairing, bounded queues, seeking, play/pause and frame cleanup.
- Synchronized native AAC stereo and explicit-SA3D ambisonic headphone audio, with mute, mode switching and bounded local decoding; experimental, not physically audio/headset-tested.
- Frame-aligned GPMF relative-orientation stabilization; not absolute horizon leveling. See [STABILIZATION.md](STABILIZATION.md).
- Original MAX EAC projection with second-track rotation and duplicated-overlap blending.
- Experimental immersive WebXR with per-eye views and orientation-only panorama tracking; **not physically headset-tested**.
- Browser-decodable equirectangular MP4 fallback, drag/arrow-key navigation, zoom, reset, seek and fullscreen.
- A generated panorama demo (not GoPro footage), responsive UI, tests and GitHub Pages workflow.

## Run locally

Requires Node 22+ for tests and Python 3 for the static server. No npm install is needed.

```sh
npm test
npm start
# Open http://localhost:8000
```

Open an original MAX `.360` file to attempt native decoding locally. The current native demux path accepts **two 4096×1344 HEVC video tracks**. WebCodecs requires HTTPS or localhost, and HEVC availability depends on browser, OS and hardware. Passing a capability check does not guarantee two simultaneous decoders can sustain playback. Unsupported devices get an error; there is no transcoding or upload fallback.

For an exported, already-stitched video, select **View as equirectangular video**. Choose actual equirectangular material (normally 2:1); dimensions alone do not establish projection. Audio/mute works through the browser video element for this path. Native MAX audio starts muted: uncheck **Muted** to listen. When explicit supported spatial metadata is present, choose **Spatial headphones (experimental)** for head-relative sound. Stereo does not rotate with the view. See [AUDIO.md](AUDIO.md) for format support and verification limits.

**Enter VR** is enabled only if the browser reports immersive WebXR support. Both eyes share the same monoscopic panorama; headset translation is intentionally ignored. A supporting headset/browser and secure context are required.

## Current limits

- **Unverified end-to-end native playback:** real WebCodecs decode, GPU rendering, full-resolution performance, browser seeking and headset sessions still need testing on target devices.
- Native stereo/spatial audio and GPMF relative-orientation stabilization are implemented experimentally. Actual A/V listening, headset localization and general orientation conventions still need device validation. Absolute horizon leveling and optical-flow seam correction are not implemented. Basic duplicated-overlap blending is implemented, but visual seam quality is not production-validated.
- Native demux rejects reordered presentation timestamps, nonzero edit-list offsets, unsupported sample descriptions and dimensions. It is not a general-purpose MP4 demuxer. MAX2 compatibility is not claimed.
- Renderer math also has a 2272×736 template, but the current native demux path does **not** accept that mode yet.
- Metadata is capped at 16 MiB; sample counts and sample sizes are bounded. Long recordings may exceed conservative limits. No export or transcoding.
- WebGL is required. Context loss asks for reload. Browser/device capability hints are not guarantees.

## Verification

See [VERIFICATION.md](VERIFICATION.md) for exact checks and gaps. The current suite covers audio, stabilization, parsing, reading and mocked playback, including parser limits, sample tables, mocked decoding lifecycle and EAC projection math. No camera recordings or derived previews are included in this repository.

## GitHub Pages

Select **Settings → Pages → Source → GitHub Actions**. The workflow runs tests before deploying `index.html`, `src/`, third-party notices and licenses; pull requests test without deploying. Relative URLs support repository project pages. HTTPS enables the secure-context APIs needed for WebCodecs and WebXR.

Never commit camera originals; common video extensions are ignored. A private source repository does not necessarily mean a private Pages website, and private-repository Pages availability depends on the GitHub plan.

## Next release gates

1. Verify actual native playback and seeking using suitable test media on supported desktop browsers; compare orientation and seams with a trusted export.
2. Exercise rapid source switching, pause/resume, repeated seeks, end-of-file, decoder failure, context loss, GPU texture limits and long-file memory behavior.
3. Validate real-time dual decoding at full resolution, mobile thermal behavior and browser/OS/device compatibility.
4. Test actual headset WebXR sessions, per-eye views, recentering, session interruption and exit/reentry.
5. Validate synchronized native audio and telemetry-based stabilization on the target device; expand container/mode support only with verified fixtures.

## Format and attribution

Original MAX `.360` files are not ordinary equirectangular videos. GoPro stitches in-camera, then stores a GoPro-specific multi-track EAC layout requiring unpacking and reprojection.

- [GoPro: MAX stitching and resolution](https://gopro.com/en/dm/news/max-tech-specs-stitching-resolution)
- [Trek View max2sphere](https://github.com/trek-view/max2sphere/blob/main/max2sphere.c): projection/blending reference, Apache-2.0; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- [MAX_RENDERER.md](MAX_RENDERER.md): renderer API, ownership and projection validation.

## Playback diagnostics

Native playback now pauses its media clock while buffering paired frames, rather than skipping ahead during a decoder stall. If playback still buffers repeatedly, choose **Save playback diagnostics** after reproducing it. The downloaded JSON contains only technical counters, queue sizes, codec dimensions and timings; no filename, footage, audio, path or automatic upload. Share that report manually if troubleshooting is needed. Hardware performance remains device-dependent.

Files up to **64 MiB** prepare once in shared local memory before either decoder receives frames. Larger files use shared, aligned **64 MiB chunks**. Both tracks reuse the same physical reads, and their sample tables guide asynchronous lookahead while the current chunk is playing. Distant track layouts have room for two current chunks and two lookahead chunks.

The large-file reader reserves at most **256 MiB** across cached chunks **and reads still in flight**, with at most two simultaneous local reads. Exact sample copies can add up to 32 MiB per active track; decoder, metadata, browser, and GPU allocations are separate. This is not a total browser-memory cap. No full 1200 MiB recording is loaded at once. Seeking cancels obsolete consumers and queued speculation; uncancelable Blob reads retain their reservations until they finish, and stale results are discarded. A new seek may briefly await such an active read slot. Ready chunks can be reused for nearby seeks.

Startup deliberately waits for the first 64 MiB chunk. On slower storage that can take several seconds; the next chunk is read ahead rather than waiting for a playback miss. Prefetch cannot overcome storage slower than the sustained video bitrate, insufficient HEVC decode throughput, or a GPU bottleneck. Small-file preparation, decode/frame limits, projection, and zoom are unchanged. Everything stays in local memory: no upload or persistent browser copy.

Diagnostics **v7** reports the strategy, shared physical read/prefetch/cache counters, sample-copy bytes, current/peak reserved compressed bytes, concurrent reads, canceled consumers and discarded reads, plus decoder-output latency and animation-frame gaps. Audio scheduling/clock counters and stabilization status/read latency are also included. Native telemetry now uses the same shared input cache instead of issuing a separate physical read at every packet boundary. Shared reads are counted only once. GPU upload timings do not measure asynchronous GPU draw completion.

### Reproducible input benchmark

```sh
node scripts/benchmark-input.mjs
```

This is a deterministic **synthetic storage model**, not real HEVC playback or a hardware FPS benchmark: 1200 MiB, interleaved 128 KiB samples, 30 paired frames/second, a shared 16 MiB/s disk and 20 ms overhead/read. Physical reads fall from **600 to 19**, and read volume from **2399.88 to 1200.00 MiB**. In that model, playback-time storage waits fall from 299 to zero after an initial 4.02-second preparation (previous startup: 0.54 seconds). Peak reserved compressed input stays at 256 MiB. Actual results depend on the file layout, storage, browser, CPU/GPU and HEVC hardware; real-device smoothness still needs confirmation.
