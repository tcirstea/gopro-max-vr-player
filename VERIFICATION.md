# Verification — 2026-10-28

## Passed

- `npm test`: **40/40 tests**, Node 24.22.1.
- `node --check` for every `src/*.js` module.
- Metadata/parser tests: single/dual tracks, native detection, codecs/dimensions, media-payload skipping, malformed/truncated/extended/zero-sized boxes, metadata limits and safe time formatting.
- Native tests: sample offsets/timestamps, codec configuration strings, invalid offsets/dimensions/reordered timestamps, **mocked** paired decode, duration/seek behavior, frame cleanup, unsupported-codec and partial-configuration failure, separate decode-request/output backpressure and 24-sample hard outstanding cap.
- Projection tests: known templates, face/track rotations, overlap coordinates/weights, sphere-wide bounds, invalid rays and asymmetric projection-matrix inversion.
- Source review found no runtime fetch/upload path or CDN dependency. CSP disables network connections and limits browser video media to Blob URLs.

No camera recordings or derived previews are included in the repository or deployed site.

## Not yet verified

- Actual WebCodecs HEVC decoding and sustained simultaneous two-decoder performance in a browser.
- WebGL shader compilation/pixels, full-resolution native rendering, orientation/seam quality during playback.
- Browser play/pause, seeking, fullscreen, source switching and mobile/touch layout/interaction.
- Actual immersive WebXR sessions, per-eye output, controllers and session lifecycle on a headset.

Browser QA was attempted. Workspace Chromium failed before loading the page because the sandbox denied socket creation. An escalated launch failed during sandbox setup with a read-only filesystem error. The connected browser could not reach the workspace static server. These are test-environment failures, not passing UI checks. Automated unit tests use mocked decoders and cannot establish actual hardware compatibility.

## Remaining implementation limits

Native audio, ambisonics, gyro stabilization, horizon leveling and optical-flow seam correction are absent. Duplicated-overlap blending is implemented. Native demux currently accepts 4096×1344 paired HEVC tracks and rejects reordered timestamps and nonzero edit offsets; MAX2 is not validated. The 2272×736 renderer template is not yet enabled through native demux.

## Browser acceptance checks

1. Open the generated demo; check graphics errors, drag/arrows/zoom/reset, narrow-screen layout and touch interaction.
2. Open suitable original MAX test media on a HEVC-capable browser. Verify both decoders, orientation, overlap seams and motion against a trusted export.
3. Play/pause, seek while paused/playing, replay after end, seek rapidly, and switch between native/equirectangular/demo repeatedly. Ensure old events and frames do not affect the newer source.
4. Test corrupt/unsupported files, unavailable WebCodecs/HEVC, partial decoder failure, GPU limits and WebGL context loss.
5. Test equirectangular playback and audio/mute independently; native playback should remain clearly silent.
6. Enter/exit fullscreen and immersive WebXR, including interruption and reentry; validate both eyes and fixed-position panorama behavior on a physical headset.
7. Verify the deployed commit and live repository-subpath URL separately. This local verification record does not certify a particular GitHub Actions run or deployment.

## Native playback scheduling correction — 2026-10-28

- Fixed a free-running wall clock that advanced through decode starvation and could report end-of-file without presenting the ending. Playback now buffers, freezes its media clock, and resumes from paired media.
- Selects at most one matched pair per animation tick instead of uploading every overdue pair to the GPU. Projection and zoom are unchanged.
- Separates queued decode requests (4), ready-frame target (6), and retained codec inputs (hard outstanding limit 24). This avoids the old eight-input/output combined limit starving codecs that batch outputs. Hardware decode is preferred, not guaranteed.
- New deterministic tests cover codec batches larger than eight, the outstanding cap, one upload per tick, long starvation without false EOF, one-track starvation, resumed timestamps, and stale output after seek.
- Local-only diagnostics download reports queue/counter/timing/configuration data. It does not include filenames, paths, browser UA, footage, audio, or raw error strings; it makes no network request. UI regression test covers export and source-change cleanup.

## Compressed-input read-ahead — 2026-10-28

- Replaced one asynchronous local Blob read per compressed frame with bounded forward windows, independent for each video track. Retained compressed cache is capped at 4 MiB per track; samples above that limit are read exactly and not cached. Decoder output/in-flight limits, playback clock behavior, projection, and zoom are unchanged.
- Regression tests verify amortized reads (16 sample reads become 2 file reads in the fixture), exact sample slices, independent/interleaved tracks, window-crossing samples, backwards seeks, large samples, EOF clamps, invalid/truncated input, overlapping reads, and closure during an in-flight read.
- Diagnostics v3 includes per-track input read/cache/byte counts and read timings, decoder-output wall-clock latency, and maximum animation callback gap. Counters remain allowlisted technical data, with no filenames, paths, media, audio, or automatic upload.
- `npm test`: **35/35 passed**; `node --check` passed for every source module. Decoder tests are mocked, not real HEVC performance measurements. The optimization reduces per-frame file-read overhead; storage, decoding and rendering can each limit performance. Real-device playback smoothness remains unverified.

## Short-clip preparation — 2026-10-28

- Added one lazy shared compressed-file preparation for files up to 64 MiB, only after native format validation and codec support checking. Both tracks and later seeks use typed-array views of the same local buffer; no per-track copy or per-sample buffer copy. Files above the ceiling keep bounded 4 MiB per-track streaming.
- Preparation trades startup wait for eliminating playback-time local read stalls on eligible short clips; it cannot guarantee smoothness for large recordings on storage slower than the video bitrate. The cap is retained compressed bytes, not total process/decoder/GPU memory. Blob reads already in flight cannot be canceled; closure prevents late results from being retained or decoded.
- Added coverage for one shared preparation across tracks/seeks, exact byte views and buffer identity, threshold equality and larger-file fallback, preparation rejection/truncation, close while pending, UI preparation state, and keeping the media clock at EOF on subsequent paused animation ticks.
- `npm test`: **40/40 passed**. All source syntax checks passed. Actual browser HEVC playback remains a real-device validation step; mocked tests establish byte/lifecycle correctness, not smoothness.

- A decoder failure releases prepared input and cannot be revived by programmatic play/seek; reopen the file to retry. Regression coverage confirms this lifecycle.
