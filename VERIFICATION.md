# Verification — 2026-10-28

## Passed

- `npm test`: **111/111 tests**, Node 24.22.1 (shared telemetry input correction).
- `node --check` for every `src/*.js` module; `git diff --check`.
- Metadata/parser tests: single/dual tracks, native detection, codecs/dimensions, media-payload skipping, malformed/truncated/extended/zero-sized boxes, metadata limits and safe time formatting.
- Native tests: sample offsets/timestamps, codec configuration strings, invalid offsets/dimensions/reordered timestamps, **mocked** paired decode, duration/seek behavior, frame cleanup, unsupported-codec and partial-configuration failure, separate decode-request/output backpressure and 24-sample hard outstanding cap.
- Projection tests: known templates, face/track rotations, overlap coordinates/weights, sphere-wide bounds, invalid rays and asymmetric projection-matrix inversion.
- Source review found no runtime fetch/upload path or CDN dependency. CSP disables network connections and limits browser video media to Blob URLs.

No camera recordings, derived previews, extracted telemetry, or private per-recording measurements are included in the publication set.

## Not yet verified

- Actual WebCodecs HEVC decoding and sustained simultaneous two-decoder performance in a browser.
- WebGL shader compilation/pixels, full-resolution native rendering, orientation/seam quality during playback.
- Browser play/pause, seeking, fullscreen, source switching and mobile/touch layout/interaction.
- Actual immersive WebXR sessions, per-eye output, controllers and session lifecycle on a headset.

Browser QA was attempted. Workspace Chromium failed before loading the page because the sandbox denied socket creation. An escalated launch failed during sandbox setup with a read-only filesystem error. The connected browser could not reach the workspace static server. These are test-environment failures, not passing UI checks. Automated unit tests use mocked decoders and cannot establish actual hardware compatibility.

## Remaining implementation limits

Native AAC stereo, metadata-gated ambisonic headphone rendering, and GPMF relative-orientation stabilization are implemented experimentally. Absolute horizon leveling and optical-flow seam correction remain absent. See AUDIO.md and STABILIZATION.md for evidence and limits. Duplicated-overlap blending is implemented. Native demux currently accepts 4096×1344 paired HEVC tracks and rejects reordered timestamps and nonzero edit offsets; MAX2 is not validated. The 2272×736 renderer template is not yet enabled through native demux.

## Browser acceptance checks

1. Open the generated demo; check graphics errors, drag/arrows/zoom/reset, narrow-screen layout and touch interaction.
2. Open suitable original MAX test media on a HEVC-capable browser. Verify both decoders, orientation, overlap seams and motion against a trusted export.
3. Play/pause, seek while paused/playing, replay after end, seek rapidly, and switch between native/equirectangular/demo repeatedly. Ensure old events and frames do not affect the newer source.
4. Test corrupt/unsupported files, unavailable WebCodecs/HEVC, partial decoder failure, GPU limits and WebGL context loss.
5. Test equirectangular playback and audio/mute independently; native playback starts muted; verify stereo, spatial headphones, pause/seek/mode switching and A/V alignment independently.
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

## Large-recording chunk preparation — 2026-10-28

- Shared aligned **64 MiB** compressed chunks replace the per-track 4 MiB miss-only reads for files above 64 MiB. Pending and ready reads are deduplicated across tracks. Actual per-track sample-table transitions guide lookahead, including distant/non-sequential chunks; queued demand takes priority over speculation.
- Four chunk slots bound cached plus in-flight input reservations to **256 MiB**, with at most two physical reads active. Returned samples are exact copies so a small sample cannot pin an evicted 64 MiB buffer. These copies add at most 32 MiB per active track; metadata, WebCodecs input/output, browser, and GPU allocations are outside this compressed cache budget.
- Native seeking now resets input consumers and obsolete queued work as well as decoders. Blob reads cannot be physically canceled; their reservations remain charged until settlement, late results are discarded, and ready cache entries can survive nearby seeks. Closure rejects pending consumers immediately and releases ready buffers. Speculative errors are caught and only reported if the failed chunk is demanded.
- Added 15 small-buffer tests for exact/cross-boundary/EOF sample bytes, concurrent deduplication, distant-track no-thrashing, actual-sample lookahead, delayed prefetch/cache-hit independence, demand priority, simultaneous boundary crossings, seek storms, cache reuse, stale completion, close, invalid/truncated input, speculative errors, and sparse fake 1200 MiB input.
- Added mocked-decoder large-input integration tests: 20 seeks while physical reads are stalled, no obsolete input submitted to old decoders, reservation/concurrency bounds, and no payload reads before codec support checks. UI regression covers the large-buffer preparation message. Renderer and zoom code are unchanged.
- `npm test`: **57/57 passed**; `node --check` passed for all source modules. These tests establish reader correctness/lifecycle, not actual browser HEVC smoothness.
- `node scripts/benchmark-input.mjs`: deterministic synthetic 1200 MiB interleaved recording with a serial 16 MiB/s disk, 20 ms per physical read, 128 KiB samples and 30 paired frames/second. Physical reads: **600 → 19**. Read volume: **2399.88 → 1200.00 MiB**. Initial preparation: **0.54 → 4.02 s**. Playback storage waits: **299 → 0**, with total modeled read waiting **161.992 → 4.020 s**. Peak reserved compressed input: **256 MiB**, maximum simultaneous reads: **2**. This is a model of read scheduling and duplicated input work, not a measured device throughput, decoder FPS, or promise of stutter-free playback.
- No original large recording or device diagnostics were available for this change. Real HEVC/GPU performance, actual storage latency, and target-device memory pressure remain user-device acceptance checks.


## Combined audio, stabilization and immersive scheduling — 2026-10-28

- AAC-LC stereo/mono and metadata-gated first-order spatial PCM are parsed independently of video support. Tests cover packet tables, format rejection, edit trimming, channel conversion, ambisonic axis mapping and the discrete-channel headphone graph.
- Native audio shares the bounded video input cache. Mocked A/V tests cover the audio-master clock, video starvation, muted playback, seeks, stale decoder output, mode switching, short audio, duration clipping, scheduling bounds, failure and closure.
- Fixed an integration rewind when AudioContext suspension occurs between render ticks: buffering now captures the actual audio-clock instant. A regression reproduces and verifies this case.
- Native playback now advances from the renderer's single active desktop/XR loop before textures are drawn. This avoids depending on window animation frames during immersion, which the [WebXR specification](https://immersive-web.github.io/webxr/#animation-frames) does not guarantee. Mocked tests cover desktop-to-XR transition, consecutive immersive ticks without window ticks, suppression of duplicate window advancement, return to desktop, source replacement and closure.
- GPMF tests cover bounded parsing, scaling, frame ordinals rather than padded packet timing, noncommuting CORI/IORI composition, stable first-frame reference, lazy caching, cancellation and malformed/absent metadata. Renderer tests check matching view/stabilization matrices for image sampling and the audio listener.
- Final aggregate: **103/103 tests pass**, all source syntax checks pass, and `git diff --check` passes. These are synthetic/mocked software checks. Actual HEVC/AAC WebCodecs execution, GPU pixels, sustained playback, acoustic A/V alignment, headphone localization and physical-headset behavior remain unverified on a supported target browser/device. The historical browser-launch/network blockers above are not passing browser checks.
- Private sample-derived measurements are deliberately excluded from published documentation. Generic methodology and reproducible synthetic evidence are retained in this file, AUDIO.md and STABILIZATION.md.


## Shared telemetry input correction — 2026-10-28

- Native stabilization previously awaited an exact Blob read at each GPMF packet boundary before submitting track-0 video. Those waits bypassed the shared compressed-input cache and were not included in decoder-output latency. Telemetry now has a dedicated declared consumer and sample-table lookahead in the same bounded input as video/audio; already-parsed movie metadata is reused. Neither stabilization nor audio is disabled, and output/decode/cache limits, projection and zoom are unchanged.
- Two synthetic integration regressions deliberately delay the second exact telemetry read while the video bytes are cached. Before the correction, both small-file and large-chunk paths stopped at 0.96 seconds. With the correction, both present through the final 3.96-second frame of the four-second fixture, issue one physical input read and zero separate telemetry reads, and buffer only at startup. This establishes the software failure mechanism, not actual device smoothness.
- Added combined audio/video/telemetry consumer and distant-boundary contention checks; rapid seeks while physical reads are held remain within the 256 MiB/two-read limits. Added initial/later telemetry-read cancellation, stale-completion protection, preserved first-frame reference, and serialized concurrent packet preparation checks.
- Diagnostics v7 adds the telemetry input strategy and read-latency counters. Only synthetic fixtures and general evidence are included here; private diagnostics and media are not published.
- Final aggregate: **111/111 tests pass**, every source module passes `node --check`, and `git diff --check` passes. Actual target-browser HEVC/GPU/audio playback and device-specific smoothness remain unverified by these mocked tests.

## Quest controller controls — 2026-10-30

Added right-controller WebXR polling: stick Y adjusts the same clamped FOV state as wheel zoom; immersive rays now apply that zoom in eye space before head rotation. Stick X seeks ±5 seconds with 500 ms repeats, and A toggles playback on a rising edge. Native MAX and equirectangular transports share the existing play/pause paths; seeks clamp to duration. Desktop controls, head rotation and stabilization remain intact. Trigger + stick turning is deferred.

Automated tests cover dead zones/dominant axis, directions, frame-time clamping, repeat intervals, button hold/release, source filtering, disconnect/reentry/focus reset, native/equirectangular seek boundaries, disabled controls and playback failures, plus renderer wiring. The full Node suite passed: **121/121 tests**, with all source/test JavaScript syntax checks passing. The Pages workflow reruns the suite before deployment.

A local headless Chromium smoke test was attempted but did not run: sandbox sockets were denied; the approved escalation then failed while constructing the environment (`bwrap: Can't create file at /home/agent/.codex/sessions: Read-only file system`). No physical Quest hardware is available to this task. Therefore real headset button permissions, visual zoom/comfort, native seek responsiveness and reentry remain **not physically verified**.

Manual Quest check: load a clip and enter VR; push right stick forward/back to zoom; left/right should seek 5 seconds per nudge and repeat at most twice per second when held; press/release A to pause/resume (holding must not repeat). Repeat with native MAX and equirectangular clips, paused and playing, near both ends. Verify head tracking, desktop wheel/reset after exit, controller disconnect/reconnect, and headset menu interruption. Trigger/grip must remain unassigned.


### Right-stick click recenter follow-up — 2026-10-30

Right-stick click (xr-standard button 3) now recenters the current full headset orientation and restores default zoom. The inverse rotation is calculated from the current valid XR viewer pose, not desktop yaw; it is applied equally to per-eye panorama sampling and head-relative audio orientation, before source stabilization. Translation remains ignored. Look level before clicking to retain a level horizon. Tracking after reset is relative to that reference. The correction is cleared when exiting/reentering VR.

Stick click is edge-triggered and must be released after connection/interruption; holding it does not continually lock the view. Stick-axis zoom/seek is suppressed while clicked. If the current pose is unavailable, recenter waits for the next valid pose; session exit or focus interruption cancels the pending request. Desktop Reset retains its original behavior, while Reset during VR also recenters against the next valid pose.

Physical Quest validation remains unavailable; this is automated/mock verification, not a device-validation claim. Manual check: turn your head away from the initial forward view, change zoom, click the right stick, verify default forward/zoom and that subsequent head motion still works; hold the click and move your head to ensure it does not keep resetting; release/repeat; check interruption and VR exit/reentry. Confirm A and left/right seek still work and spatial audio follows the recentered view.

## Immersive session transition regression

- Serialized Enter/Exit VR operations across requestSession, graphics setup, reference-space setup, and session exit; rapid clicks cannot issue a second immersive request. The button is disabled until the transition settles.
- Registered the session-end handler before asynchronous graphics setup so a headset ending entry cannot resurrect a dead session. Late frames from old sessions are ignored.
- Setup errors attempt to end the acquired session while preserving the original diagnostic. VR errors use a separate status channel rather than “Video texture unavailable”; desktop rendering remains available after a rejected request.
- Automated regression coverage checks rapid clicks/API calls, delayed graphics setup, repeated exit, external active-session rejection, retry, early session end, failed setup/cleanup, and app error labeling. Real PC Edge/headset session behavior still requires device verification.

Combined recenter/session follow-up verification: **128/128 Node tests passed**, plus syntax checks for every source and test JavaScript file. No physical Quest or PC Edge headset test was performed in this environment.


## Retained per-session preferences — 2026-10-30

App preference state is separate from native audio state. Mute, volume and preferred audio mode are applied to each new player; unsupported modes temporarily fall back without overwriting preference. Native and equirectangular share mute/volume. New clips stay paused at their beginning. Zoom, desktop direction and active XR recenter offset are not reset by opening a file or the demo; only explicit reset actions change them. Source-specific stabilization/decoders/diagnostics still reset. No persistence across page reload, file storage or upload was added.

Automated checks cover audio gain before/after context creation, mute/unmute, mode switches, bounds, seeks and native-player volume delegation, plus source-switch preference and renderer regressions. Physical headset/browser audio behavior remains device-unverified; the prior local browser launch restriction still applies. Manual check: unmute, lower volume, choose spatial audio, zoom and recenter; switch native clips, an equirectangular clip, a silent/stereo-only clip, then a compatible native clip. Verify retained preferences, appropriate fallback, paused startup and explicit reset behavior.

Final retained-preferences checks: **135/135 Node tests passed**, and every source/test JavaScript file passed `node --check`. Tests include rapid source switching with stale callbacks, preference changes during a pending load, unsupported/silent audio fallback and restoration, native↔equirectangular↔demo transitions, and XR zoom/recenter preservation until explicit reset.
