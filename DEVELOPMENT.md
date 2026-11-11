# Development

## Setup and checks

Use Node 22+ and Python 3. There are no npm dependencies or build step.

```sh
npm test
npm start
# Open http://localhost:8000
```

Before committing, run `npm test`, `git diff --check`, and `node --check` on changed JavaScript modules. Tests use synthetic data and mocked browser APIs; passing them does not establish real browser or headset compatibility. Record checks and limitations in [VERIFICATION.md](VERIFICATION.md). That file contains dated reports; older entries describe the implementation at that time.

## Code map

- `index.html`, `src/style.css`: interface and styles.
- `src/app.js`: playback, UI and source lifecycle.
- `src/native-*.js`, `src/chunked-input.js`: MAX decoding, audio and bounded local reads.
- `src/renderer.js`, `src/max-projection.js`, `src/flat-view.js`: panorama and flat-video rendering.
- `src/playlist-*.js`, `src/next-clip-preload.js`: playlist, cross-video seeking and preparation.
- `src/xr-*.js`, `src/keyboard-controls.js`, `src/zoom.js`: controls and VR panels.
- `test/`: automated tests.

## Current limits

- **Unverified end-to-end native playback:** real WebCodecs decode, GPU rendering, full-resolution performance, browser seeking and headset sessions still need testing on target devices.
- Native stereo/spatial audio and GPMF relative-orientation stabilization are implemented experimentally. Actual A/V listening, headset localization and general orientation conventions still need device validation. Absolute horizon leveling and optical-flow seam correction are not implemented. Basic duplicated-overlap blending is implemented, but visual seam quality is not production-validated.
- Native demux rejects reordered presentation timestamps, nonzero edit-list offsets, unsupported sample descriptions and dimensions. It is not a general-purpose MP4 demuxer. MAX2 compatibility is not claimed.
- Renderer math also has a 2272×736 template, but the current native demux path does **not** accept that mode yet.
- Metadata is capped at 16 MiB; sample counts and sample sizes are bounded. Long recordings may exceed conservative limits. No export or transcoding.
- WebGL is required. Context loss asks for reload. Browser/device capability hints are not guarantees.

## GitHub Pages

Select **Settings → Pages → Source → GitHub Actions**. The workflow runs tests before deploying `index.html`, `src/`, third-party notices and licenses; pull requests test without deploying. Relative URLs support repository project pages. HTTPS enables the secure-context APIs needed for WebCodecs and WebXR.

Never commit camera originals; common video extensions are ignored. A private source repository does not necessarily mean a private Pages website, and private-repository Pages availability depends on the GitHub plan.

## Next release gates

1. Verify actual native playback and seeking using suitable test media on supported desktop browsers; compare orientation and seams with a trusted export.
2. Exercise rapid source switching, pause/resume, repeated seeks, end-of-file, decoder failure, context loss, GPU texture limits and long-file memory behavior.
3. Validate real-time dual decoding at full resolution, mobile thermal behavior and browser/OS/device compatibility.
4. Test actual headset WebXR sessions, per-eye views, recentering, session interruption and exit/reentry.
5. Validate synchronized native audio and telemetry-based stabilization on the target device; expand container/mode support only with verified fixtures.

## Playback diagnostics

Native playback pauses its media clock while buffering paired frames, rather than skipping ahead during a decoder stall. If playback still buffers repeatedly, choose **Save playback diagnostics** after reproducing it. The downloaded JSON contains only technical counters, queue sizes, codec dimensions and timings; no filename, footage, audio, path or automatic upload. Share that report manually if troubleshooting is needed. Hardware performance remains device-dependent.

Files up to **64 MiB** prepare once in shared local memory before either decoder receives frames. Larger files use shared, aligned **64 MiB chunks**. Both tracks reuse the same physical reads, and their sample tables guide asynchronous lookahead while the current chunk is playing. Distant track layouts have room for two current chunks and two lookahead chunks.

The large-file reader reserves at most **256 MiB** across cached chunks **and reads still in flight**, with at most two simultaneous local reads. Exact sample copies can add up to 32 MiB per active track; decoder, metadata, browser, and GPU allocations are separate. This is not a total browser-memory cap. No full 1200 MiB recording is loaded at once. Seeking cancels obsolete consumers and queued speculation; uncancelable Blob reads retain their reservations until they finish, and stale results are discarded. A new seek may briefly await such an active read slot. Ready chunks can be reused for nearby seeks.

Startup deliberately waits for the first 64 MiB chunk. On slower storage that can take several seconds; the next chunk is read ahead rather than waiting for a playback miss. Prefetch cannot overcome storage slower than the sustained video bitrate, insufficient HEVC decode throughput, or a GPU bottleneck. Small-file preparation, decode/frame limits, projection, and zoom are unchanged. Everything stays in local memory: no upload or persistent browser copy.

Diagnostics **v7** reports the strategy, shared physical read/prefetch/cache counters, sample-copy bytes, current/peak reserved compressed bytes, concurrent reads, canceled consumers and discarded reads, plus decoder-output latency and animation-frame gaps. Audio scheduling/clock counters and stabilization status/read latency are also included. Native telemetry uses the same shared input cache instead of issuing a separate physical read at every packet boundary. Shared reads are counted only once. GPU upload timings do not measure asynchronous GPU draw completion.

### Reproducible input benchmark

```sh
node scripts/benchmark-input.mjs
```

This is a deterministic **synthetic storage model**, not real HEVC playback or a hardware FPS benchmark: 1200 MiB, interleaved 128 KiB samples, 30 paired frames/second, a shared 16 MiB/s disk and 20 ms overhead/read. Physical reads fall from **600 to 19**, and read volume from **2399.88 to 1200.00 MiB**. In that model, playback-time storage waits fall from 299 to zero after an initial 4.02-second preparation (previous startup: 0.54 seconds). Peak reserved compressed input stays at 256 MiB. Actual results depend on the file layout, storage, browser, CPU/GPU and HEVC hardware; real-device smoothness still needs confirmation.
