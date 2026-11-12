# Verification

## Current device status — 2026-11-12

The user confirms that native GoPro MAX files work and have been tested in a browser and in VR through Quest Link on Windows. Performance directly in the standalone Quest browser has not been tested. This confirms those playback paths, not every codec, device or edge case.

The dated entries below preserve the checks and limitations recorded at each development stage. Statements that physical-device testing was unavailable describe those earlier checks, not the current overall playback status.

## Initial verification — 2026-10-28

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


## Right-grip controller drag and rotation — 2026-10-30

Right grip/squeeze (the lower/side trigger, xr-standard button 1) grabs the panorama using the controller's tracked grip pose (target-ray pose fallback). On press it captures the existing correction, controller position/rotation and head orientation. Controller displacement in the viewing plane at grab time pans the panorama at 2 radians/metre; inverse controller rotation additionally adjusts yaw, pitch and roll. Forward/back translation is ignored. Release retains the accumulated correction without a discrete snap. Head tracking stays independent: moving only the head does not change the panorama correction. This reorients 360° footage; it cannot create positional camera movement.

The same correction feeds shader sampling and spatial audio, before video-specific stabilization. Zoom remains unchanged; explicit recenter while held establishes a fresh neutral controller anchor and default zoom. Disconnect, focus loss and session exit cancel drag input. Holding grip on entry/reconnection does not activate it until released and pressed again. Tracking loss rebases on the next valid pose instead of applying a stale anchor. Source switches retain the viewing correction, matching the existing preference policy.

Physical Quest/PC headset comfort and behavior are not device-verified. Manual check: hold the right grip, move the controller left/right/up/down to drag, then rotate it including roll to level a tilted video. Release and look around normally; the new adjustment should remain. Head-only movement during grip must still look around rather than drag. Repeat at nondefault zoom and after recenter, while paused/playing, with spatial audio, across focus interruption and controller reconnect. Upper trigger remains unassigned; trigger-plus-stick turning is still deferred.

## Local playlist — 2026-10-30

Multi-file selection now creates a local queue in file-picker order, with Previous/Next and a clip dropdown/count. Initial selection is paused; manual navigation preserves playing/paused intent, and native/browser end-of-clip advances to the next clip without looping at the end. Non-native clips retain explicit per-clip projection confirmation; blocked autoplay asks for Play. Unsupported clips stop with a skip hint. New selection/demo invalidates pending loads and end callbacks. Audio/view preferences persist and only the current clip has active playback resources.

Tests cover navigation boundaries, auto-advance and repeated end notifications, manual paused/playing transitions, projection confirmation, unsupported clips, selection races/stale completions, blocked playback, stale play rejection, and queued advancement canceled by demo or a new queue. Files/filenames remain local; no media has been added to the repository or uploaded. Physical headset/browser playlist playback remains unverified.

Controller-drag/playlist checks are automated/mock verification; no physical headset validation or successful local browser UI smoke test is claimed.

Final revised controller-drag + playlist verification: **147/147 tests passed**, including **17 focused XR tests**, plus syntax checks for every source/test JavaScript file. These are local checks; GitHub Actions reruns the full suite before Pages deployment.


## Right-stick click now resets zoom only — 2026-10-30

This supersedes the earlier stick-click recenter behavior. Right-stick click resets only FOV to its default; it does not modify yaw, pitch, XR recenter/drag correction, active controller-drag anchor or spatial-audio orientation. Full recenter remains available through the separate Reset view button. Click remains edge-triggered, with axes suppressed while held. Tests verify orientation and roll preservation, including while dragging, plus normal one-shot click behavior and unchanged explicit Reset view behavior. Physical headset validation remains outstanding.

Zoom-only click release check: **147/147 tests passed**, plus all source/test JavaScript syntax checks. Regression coverage confirms preserved yaw/pitch, controller roll correction, audio orientation and active drag anchor; full view reset is tested separately through `renderer.reset()`.

## Expanded zoom detents, mirrored controls and immersive transport — 2026-10-30

Zoom FOV expands from 0.4–2.1 to 0.15–2.8 radians with unchanged speed. The old minimum, default π/2 and old maximum are detents: crossing lands exactly on the marker, discards overshoot and pauses 500 ms. Centering the zooming stick releases the hold immediately; strict crossing prevents getting trapped by repeatedly triggering the same marker. Wheel input uses the same stops with a 150 ms idle gesture boundary; keyboard zoom releases its hold on key-up. Explicit zoom/view reset clears pending detents. Tests cover both directions, large deltas, boundaries, timeout/release, no residual movement and actual renderer wheel/keyboard/XR integration.

Both controllers now support zoom, seek, zoom-only stick click, grip/controller drag and A/X play/pause. B/Y summons/toggles a world-space transport panel. The first grip owns drag until release; held competitors cannot steal it. Right stick wins concurrent active sticks. Simultaneous face-button/click actions coalesce, with right priority for simultaneous panel summons. Tests cover both hands, focus loss, disconnect, held entry and ownership transitions.

The lazily allocated WebGL panel sits 1.6 metres along the invoking controller ray and faces the headset at placement. Upper/index trigger selects on release; progress drag previews and commits a single seek. State comes from current native/browser transport; previous/next and seek honor availability. A two-second cumulative active-playback timer hides the panel, excluding pause, buffering and active captures. Media change/focus/session/tracking loss cancel scrubs. Panel rendering restores modified GL state even when drawing fails; actions are deferred outside the render callback, and Exit uses the existing serialized session transition.

Automated tests include panel placement/ray hit tests, action mapping, timer behavior, scrub lifecycle, media-state/actions and GL restoration. No real headset/browser WebGL smoke test is claimed; physical panel legibility, pointing ergonomics, expanded-zoom comfort and target-device media performance remain manual validation items. No footage or user files were uploaded or added to source.

Combined release validation: **172/172 tests passed**, plus syntax checks for every source/test JavaScript file. Renderer-panel integration verifies lazy B/Y creation, state provider, one update/two eye draws, deferred actions, serialized exit, lifecycle reset/reuse and stale-action suppression.


## Bumper reveal and sortable thumbnail playlist — 2026-11-06

Added hidden-panel reveal on either index-trigger rising edge, retaining B/Y toggle and grip drag. The opening press cannot select a control. Added a world-space playlist window with list/grid, paging, five sort keys and direction. Selecting a stable clip ID hides controls before opening it. Browsing is exempt from transport auto-hide.

A desktop native dialog mirrors the queue, supports keyboard/backdrop/close dismissal, paging, list/grid, and stable keyboard focus during metadata/thumbnail updates. Filenames use text nodes. Sorting preserves the current clip and updates Previous/Next and autoplay order. Missing dates remain last for both directions; original addition number is immutable. Filesystem creation dates are explicitly unavailable rather than substituted with lastModified. Projection confirmation is remembered per File for repeat visits.

Local previews use a browser midpoint seek or a bounded single-track `.360` HEVC sync-sample decode nearest midpoint. Previews are limited to 320 pixels, run sequentially while paused, abort on play/switch/disposal, time out after ten seconds, and clean up frames/decoders/object URLs. Metadata inspection uses existing bounded movie reads. Tests are synthetic and no private footage or user filenames have been published.

Validation: full Node suite and JavaScript syntax checks run locally. Physical Quest behavior, hardware HEVC thumbnails and visual browser rendering remain unverified: local headless Chromium launch was blocked by the environment's socket restrictions, including an approved elevated attempt; the supported cloud browser could not connect to the local preview server. Automated DOM/dialog, mock WebXR and decoder tests are not a substitute for these manual checks.

Final local release check: **206/206 tests passed**, including background preview cancellation, pending-play exclusion and stale queue races. Every source and test JavaScript file passes `node --check`.

## Browser experimental settings and file metadata — 2026-11-06

The existing desktop playlist dialog is retained rather than duplicated: one Browse playlist button opens list/grid, paging, selection and shared queue sorting. Added browser-only Experimental settings for native audio preference and opt-in midpoint preview generation, off by default. Unsupported audio preferences are retained without unmuting; the current clip's fallback is explained. Repeated frame callbacks do not mutate an unchanged live audio status. The settings do not add immersive control actions or change headset mappings.

Preview generation remains sequential, paused-only and cancelable. Turning it off cancels pending work; late results are ignored. Turning it on retries missing previews, while completed previews remain until the queue is replaced. Browser gallery labels distinguish generated midpoint frames and unstitched native keyframes. Verified native track metadata selects the native path even for renamed MP4 files. Embedded image formats are not implemented; placeholders and the opt-in generated fallback are explicit rather than claiming an unverified embedded thumbnail.

Bounded static GoPro GPMF metadata reads whitelist model and firmware only. Tests cover nested DEVC records, text type/length, zero-filled reserve padding, malformed tails, record/depth/byte bounds, firmware-only data, optional malformed user-data boxes and exclusion of identifying fields. Timed GPS/telemetry is not scanned by this gallery reader. Duration, codec and per-track dimensions come from container metadata. Creation clock values are shown as stored, with timezone unverified; these fields are not represented as guaranteed capture instants or shifted into the browser's local timezone.

Final local validation: **221/221 Node tests pass**, every source/test JavaScript file passes `node --check`, and `git diff --check` passes. The independent code review findings were corrected and covered by regressions. Synthetic fixtures only are included in source. Local Chromium UI execution remains blocked by the environment's socket restrictions, including an authorized escalation attempt. No successful visual browser or physical headset test is claimed; real codec execution, small-screen/keyboard layout and headset ergonomics still require target-device validation.


## Larger playlist rows and default generated previews — 2026-11-06

This supersedes the earlier opt-in, session-only gallery behavior. Generated previews now default on when there is no valid explicit saved choice. Only user changes to the generation and row-height checkboxes are stored as two namespaced boolean values; startup does not save defaults. Explicit false is preserved on reload. Old versions never saved these preferences, so their previous session-only choices are unavailable. Missing, malformed, unavailable or throwing storage safely falls back to defaults, and failed writes do not interrupt the current session. No media, filenames, metadata or previews are saved.

The browser-only double-height setting applies to both galleries. Browser list rows have 144/288-pixel minimum heights with 144×81/288×162 preview boxes. Metadata may expand a row rather than clip; on narrow screens large previews use 192×108 instead of 96×54 and stack above the text. Browser large lists show six items per page, preserve the first visible page item and keyboard focus where it remains on the page, and grid keeps its prior twelve-item paging. The browser preview canvas uses the existing 320-pixel generated preview resolution; this adds no decoding. VR list hit rectangles double in height, show two items instead of five and double the preview box in both dimensions; images retain their aspect ratio rather than stretching. A density change cancels a held VR selection and resets its page. VR grid keeps six items per page.

Synthetic automated regressions cover absent/invalid preferences, saved opt-out and opt-in across reloads, denied/full storage, unchanged playback/sort/selection during row changes, larger DOM list classes and repagination, grid invariance, all VR target bounds, larger proportional thumbnail drawing, live repaint, paging/selection and held-trigger cancellation. Existing cancellation, pending-play exclusion, sequential generation, single-track midpoint decode and stale-selection tests still apply; rapid generation off/on is now covered explicitly. No separate GoPro image files are searched and no private footage is used.

Release verification: **230/230 Node tests passed**, all source/test JavaScript passed `node --check`, and `git diff --check` passed. Physical headset rendering/ergonomics, real native HEVC decoding and narrow-screen visual rendering are not established by these mock tests. The prior local Chromium/socket execution restriction was not retried or bypassed.


## Wider large previews and simpler playlist information — 2026-11-06

The large browser preview box expands from 288 to 576 pixels wide (192 to up to 384 pixels on narrow screens). Its drawing surface is now 640×280 instead of a letterboxed 320×180, so wide native preview content gains actual display area without stretching or cropping. The box uses a 16:7 ratio within the existing 288-pixel minimum row; rows wrap when the preview and text cannot fit side by side. The dialog width, normal list size, paging and browser grid preview dimensions are unchanged. In VR, large preview boxes expand from 216 to 432 pixels wide and use the row's available height while preserving image aspect. Physical row bounds and ray targets remain unchanged.

Both browser and VR items now show only the filename, size and date, with size and date on separate lines. Grid tiles retain their bounds and allocate room for the same text. Dates retain stored clock values, with no “Embedded” label, timezone suffix or browser-timezone shift. A shared gallery note preserves the timezone caveat; missing dates remain explicit. Metadata reading, sorting, playback and generation lifecycle are unchanged.

New synthetic tests verify the wide preview drawing surface and source aspect, grid invariance, responsive CSS constraints, exact three-line metadata content, unavailable dates, VR text/image bounds, truncation and repainting. Existing focus, sorting, selection, paging and held-trigger cancellation regressions remain in the suite. No private footage or derived previews were used or added. Local browser visual rendering and physical headset validation remain unverified; the prior socket restriction was not retried or bypassed.

Release validation: **233/233 Node tests passed**, every source/test JavaScript file passed `node --check`, and `git diff --check` passed. Independent code review found no concrete defects; it also ran the 27 focused gallery/panel/date tests successfully. These checks do not establish visual browser rendering or physical headset behavior.


## Current-video paging, bumper dismissal and desktop inputs — 2026-11-07

Both galleries open/reopen on the current stable clip ID in the current sorted queue. A shared pagination cursor retains its anchor across list/grid and row-density changes, including repeated switches between unequal page sizes without backwards drift. Manual navigation remains independent of current playback until reopening, a current-clip change or an explicit sort change. Metadata reorders retain the stable anchor; stale IDs, replacement queues, duplicate filenames, empty queues and final partial pages are covered. XR cancels held item captures whenever page targets change.

The desktop dialog additionally scrolls the current clip into view on every opening, even when the DOM is unchanged. Page navigation reveals its first row. Layout/density changes retain the viewport-visible clip if the reader has scrolled away from the prior anchor, without losing a still-visible anchor on repeated switches. Metadata-only redraws preserve scroll and restore keyboard focus with preventScroll.

Either bumper now hides a visible panel when its tracked ray misses the entire panel and no interaction is captured. The opening press remains non-selecting, and blank/disabled panel hits, missing tracking and an active scrub do not accidentally dismiss it. Tests cover both hands, held/repeated presses, the larger playlist surface, focus loss and reconnect.

Desktop Space toggles play/pause once per press. Left/Right seek by five seconds with 500 ms held repetition through the same native/browser transport path as XR. Native controls, editable elements, dialogs, modified shortcuts and composition keep their own keys; focus/visibility loss cancels holds. Right mouse drag rotates like the existing left drag, with pointer ownership/cancellation and viewport-only context-menu suppression. Middle mouse press resets only zoom, preserving orientation and suppressing viewport autoscroll. Native and browser playback boundaries, paused/playing state and input lifecycle have regression coverage.

Local validation: **264/264 Node tests passed**, every source/test JavaScript file passed `node --check`, and `git diff --check` passed. Independent review identified the desktop viewport-scroll gap, which was fixed and covered by scroll-aware tests. Synthetic fixtures only; no private footage or derived previews were committed. Physical headset validation remains unavailable. The supported cloud browser loads the live player but reports WebGL unavailable, so panorama rendering, right-drag visual movement and VR cannot be established there. The previously denied local Chromium/socket route was not retried or bypassed. A follow-up aligns the canvas accessibility label and visible keyboard/mouse/bumper help with these controls, with a regression test for the published instructions.

## Desktop line-of-sight roll — 2026-11-07

Supersedes the earlier right-drag-as-pan behavior. Left mouse drag still pans yaw/pitch. Right mouse horizontal drag now rolls around the current camera-local Z axis at 0.004 radians/pixel; rightward drag turns the image clockwise, leftward counterclockwise. Vertical movement while right-dragging does not pan. Shader order is source stabilization × yaw × pitch × roll, with the same order for spatial-audio orientation. This preserves the center ray even at nonzero yaw/pitch rather than rotating around world Z.

Middle click resets only zoom; source changes retain roll, pan and zoom while replacing source-specific stabilization. Reset view clears all desktop angles/zoom and cancels an active pointer capture. Desktop roll, like desktop pitch, is not applied in immersive mode, which retains the established headset/grip correction and full recenter behavior. Desktop roll is retained on ordinary VR entry/exit and cleared by explicit full reset.

Local validation: **267/267 Node tests passed**, all source/test JavaScript syntax checks passed, and `git diff --check` passed. Coverage includes nonzero-yaw/pitch center-ray invariance, shader rotation order/audio agreement, reverse, multi-turn wrapping and vertical-only right drags, middle-click preservation, source transitions, full reset during capture, competing pointers, cancellation/focus/visibility/button-release cleanup, and XR entry/exit isolation. The earlier on-page keyboard/mouse/bumper help corrections are retained and updated for distinct pan/roll gestures. These are automated/mock checks; rendered browser/physical headset behavior has not been newly verified.


## Optional desktop headset mirror — 2026-11-07

Added **Experimental settings → Mirror headset on this screen**, off by default and never persisted. While a computer-hosted XR session is active, the renderer draws one eye (left preferred) into the existing canvas default framebuffer from the XR callback after both headset views. It reuses the actual eye projection/pose and shared zoom, recenter, grip correction, stabilization, video textures and in-app panel. The eye aspect is letterboxed, with a 1280-pixel longest-side cap. No XR framebuffer copy/readback, second decoder, extra playback tick, extra audio output, network path or private media was added. Headset system overlays/passthrough are not included, and standalone Quest does not cast to a computer.

Synthetic regressions verify default-off/no extra work, exact asymmetric-eye shader inputs, native/equirectangular source changes and one texture upload, single playback/panel update per frame, control-panel draw/eye choice, grip/recenter/zoom equality, opt-out/re-enable, tracking and visibility interruption, empty/mono views, zero-size/resize/fullscreen sizing, session exit/reentry and ordinary desktop angle restoration, context loss, mirror-error isolation and XR framebuffer/viewport restoration. App tests verify opt-in UI, reload default, no-graphics disabled control, checkbox/error synchronization, visible privacy/cost/standalone explanation and retained browser Full screen/Exit VR controls. Existing desktop and headset regression tests remain in the suite.

Independent review found no GL/opaque-framebuffer blocker and identified that hiding the full desktop HUD also hid Full screen/Exit VR. The CSS now hides only unrelated labels/crosshair and preserves those controls. Local aggregate: **280/280 Node tests passed**, every source/test JavaScript file passed `node --check`, and `git diff --check` passed. Tests use synthetic fixtures and mocked GL/XR; no private footage, derived previews or diagnostics were included. Physical headset output and actual browser compositor/GPU behavior remain unverified. The available supported cloud browser lacks WebGL. The previously denied local Chromium/socket route was not retried or bypassed.

Target-device acceptance: start with the generated demo, enable the mirror and enter VR from a connected computer; turn your head, adjust stick zoom, grip-drag/roll and reset, and compare the monitor's one-eye view. Reveal the transport and playlist panels and confirm matching visibility/pointer position. Test paused and playing native/equirectangular clips; toggle the mirror repeatedly, resize/fullscreen, open a headset system menu, interrupt tracking, switch clips and exit/reenter VR. Confirm disabled mode avoids added GPU cost and stopping the mirror clears its last image. Check performance on the actual PC/headset/browser; the automated suite cannot establish compositor support or smooth playback. Do not use private clips for published QA artifacts.

## Current clip filename and file date above VR controls — 2026-11-07

A separate transparent, outlined-text caption sits just above the transport panel or the taller playlist window, anchored to the panel's local up direction. The background dimensions, world center, control positions and ray targets remain unchanged. Filename text is measured, Unicode-safe ellipsized and clipped, rather than horizontally squeezed. The caption is non-interactive and outside the original panel hit surface. It follows panel visibility and is also included in the existing opt-in desktop headset mirror; the monitor privacy notice now explicitly mentions filename and file date visibility.

The caption uses the current stable playlist ID and existing bounded local metadata inspection. It updates from “Reading file date…” to the stored movie/media date or “Date unavailable”, without new file reads, uploads, persistence or a last-modified fallback. It is labeled File date, with timezone unverified, because embedded creation fields may describe an export and may encode local wall-clock values. No browser-timezone conversion is applied. Demo/cleared selections have no caption. Switching clips, sorting, delayed old metadata, queue replacement and page hiding cannot attach an old date to a new selection.

A separate 1024×96 texture is repainted/uploaded only when caption content changes or the panel reopens, and reused between both eyes and the optional mirror. Alpha blend factors/equations, unpack settings and existing GL state are restored even on upload/draw failure. Disposal is idempotent and deletes both panel/caption textures; disposed controls cannot reopen. No private footage or derived previews are included.

Release validation: **289/289 Node tests passed**, every source/test JavaScript passed `node --check`, and `git diff --check` passed. Independent read-only review found no blocking issues and ran 54 focused tests; optional Unicode hardening from that review was applied and covered. Synthetic/mock tests cover placement, transparency, clipped names, live metadata, stable selection, missing dates, texture reuse, unchanged buttons, playlist transitions, auto-hide, visibility interruption, disposal and GL error restoration. Physical-headset readability/comfort and real WebGL rendering remain unverified. The previously denied local browser/socket route was not retried or bypassed.

Target-device check: open a synthetic or non-private clip with a known embedded date, summon controls and confirm the two text lines sit above the unchanged panel. Try a long filename, absent date, Next/Previous, sorting, the taller playlist, hide/reopen, focus loss and the opt-in desktop mirror. Verify legibility against bright and dark panoramas and that old metadata never appears after a clip switch.


## Desktop headset mirror quality — 2026-11-07

Added **Headset mirror quality → Performance / Match headset** in Experimental settings. Performance retains the 1280-pixel longest-side cap and remains the reload default. Match headset uses the current left-eye XR viewport's pixel dimensions (first available eye as fallback), sizing the monitor drawing buffer to include letterboxing so the fitted eye reaches the requested resolution. Fullscreen, aspect changes and dynamic XR eye dimensions are recalculated on each mirrored frame. Desktop DPR is not applied to XR pixels. The selected quality survives clip changes, mirror opt-out/re-enable and XR reentry within the page, with no persistence. Outside an active mirror, it does no extra rendering or GPU-limit querying and leaves desktop sizing unchanged.

The monitor buffer is uniformly clamped to GPU texture, renderbuffer and per-axis viewport limits, and drawing fits the actual allocated buffer when a browser supplies less. These limits can prevent a full resolution match. The XR layer, eye viewports, projection, pose, correction matrices, video decoding/upload cadence, audio and playback ticks are unchanged. Quality can be selected before entering fullscreen; extra pixels increase GPU and memory cost. The existing mirror-only error path restores the XR framebuffer/viewport and disables only the mirror. This is a new render of shared textures, not compositor capture or a promise of identical perceived headset sharpness.

Local validation: **298/298 Node tests passed**, all source/test JavaScript passed `node --check`, and `git diff --check` passed. New synthetic tests cover fitted-eye resolution with wide/tall/fullscreen canvases, rounding, DPR independence, all GPU limits and actual-buffer fallback, live quality/eye-size changes, repeated toggles, clip changes, no-XR browsers, opt-out/no extra work, error isolation and reload defaults. Existing left-eye projection, stereo/mono fallback, tracking/visibility, panel, zoom/recenter, source/upload and session lifecycle tests still pass. No private footage or derived previews were used. Real GPU allocation/compositing and physical headset smoothness remain unverified; the prior denied local browser/socket route was not retried or bypassed.

Target-device check: use the generated demo first, select Match headset, enable mirroring and enter computer-hosted VR. Compare Performance and Match headset on the monitor, including fullscreen and a tall window; check eye aspect and in-app panels. Verify head tracking, zoom, audio and headset resolution do not change, and check sustained frame rate/GPU cost on the actual device. Exit/reenter VR, switch clips, opt out/re-enable and reload; ordinary desktop rendering should resume at exit and Performance should return on reload.

## Bounded next-clip preparation — 2026-11-07

During the last 15 seconds of advancing playback, prepare exactly the current sorted queue's next stable item. Native MAX preparation reuses parsed sample tables and one compressed startup chunk, capped at 64 MiB (whole-file preparation for smaller files). No extra video decoder, AudioDecoder, AudioContext, hidden playing media element or standby GPU texture is allocated. Browser clips with existing per-File projection confirmation stage a byte-identical local Blob with a 32 MiB maximum prefix; the original file slice supplies the remainder. The prefix and construction copy together fit the same 64 MiB allowance. Unconfirmed browser clips cache metadata only. Metadata/sample tables, browser internals, decoder memory and the current native cache (up to 256 MiB) are separate from this compressed-input allowance.

Preparation is serialized even after cancellation: non-abortable Blob reads finish before another speculative preparation starts. Manual navigation never consumes prepared data. Natural EOF promotes only a complete exact-successor result, after the current decoder callback returns, and keeps the last rendered texture instead of swapping to the demo. Missing, pending, malformed or failed speculation uses the ordinary open path without waiting, skipping, erroring the current clip or repeated immediate retries. Queue changes, sort changes, duplicate filenames, pause, buffering, seeks, replacement, demo, error and disposal are covered. Seeking discards prior preparation; normal playback can rearm after advancing 250 ms past the target. Browser media still uses only its existing playback element and autoplay/projection permissions.

Automated tests use generated byte fixtures and mocked transport/decoder/renderer interfaces. They verify bounded input reuse, decoder-free preparation, metadata and byte-equivalent browser payloads, ownership transfer and cleanup, serialized stale reads, fallback, sorted queue identity, retained end-frame behavior and current audio preferences. No private footage, filenames, previews or diagnostics were added. Native dual-decoder initialization, audio-context startup and browser media loading still happen at file boundaries: this is reduced setup latency, not guaranteed gapless audio/video or a merged continuous timeline.

Target-device checks remain necessary: play consecutive non-private GoPro split clips on the intended browser/headset; measure the last-to-first-frame gap and audible pause, watch sustained playback during the final 15 seconds, and try manual skips, seeks, pause, sorting, replacement and unsupported files. For equirectangular clips, test confirmed and unconfirmed successors and browser autoplay restrictions. The previous denied local browser/socket route was not retried or bypassed; no successful real-browser HEVC, visual WebGL or physical-headset performance test is claimed here.

Local validation: **314/314 Node tests passed**, every source/test JavaScript file passed `node --check`, and `git diff --check` passed. Browser pause followed by sorting, waiting/rebuffering, seek rearming and page visibility have additional regression coverage; these checks are not measured target-device transition performance.

## Combined mirror-quality and next-clip release — 2026-11-07

The integrated release passes **323/323 Node tests**, all source/test JavaScript syntax checks and `git diff --check`. Independent review of next-clip preparation found no actionable correctness blocker and passed 77 focused tests plus its 314-test feature suite. Final integration retains both the mirror quality controls and automatic next-clip preparation, including both sets of regression tests. All fixtures are synthetic; no private media or derived files are included. Device-specific mirror sharpness/GPU cost and actual audio/video transition gaps remain unmeasured.


## Cross-video relative seeking — 2026-11-07

Keyboard arrows and horizontal controller sticks share asynchronous playlist-relative seeking. Offsets carry across sorted clip boundaries in either direction, including multiple short/zero-duration entries; exact forward boundaries select the next start and playlist endpoints clamp without wrapping. Native relative input reads the live media/audio clock rather than the timestamp of the last presented frame. Native destination creation accepts its initial offset, avoiding a redundant startup seek, and keeps dual-track video, audio and stabilization ownership in the existing player.

During duration resolution the current clip pauses, preserving its final playback intent. Only needed durations are inspected and cached per local File. Native readers use the playback sample tables without compressed-input preparation or additional decoders. Browser readers use one detached, metadata-only video per sequential request, never call play, time out after 10 seconds, and release their Blob URL/source/listeners. Uninterruptible native metadata reads reject stale results and close any late movie object. Input repeats accumulate during loading, and reversals can abandon projection consent even if they arrive before metadata inspection finishes. Final browser projection confirmation is unchanged. Manual navigation, sorting, absolute seeks, replacement, demo and disposal invalidate pending work. Duration failure keeps the original position; failed destination opening attempts restoration without intermediate autoplay.

Local validation: **357/357 Node tests passed** on Node 24.22.1, all source/test JavaScript passed `node --check`, and `git diff --check` passed. New tests cover forward/back overshoot, sorted multi-clip traversal, exact endpoints, first/last clamps, zero durations, live native/audio clocks, initial native offsets, repeated/reversed pending input, play/pause intent changes, superseding navigation/sort/absolute seeks, queued EOF invalidation, failures/restoration, browser seek-before-play, projection consent, both consent timing races, metadata cancellation and cleanup. Independent review confirmed the two discovered consent races were fixed and found no remaining concrete blocker.

Fixtures and browser/decoder interfaces are synthetic or mocked. No camera footage, previews or private diagnostics were used or published. Actual browser decoding, audible transition latency, physical controller behavior and headset output still require target-device checks. The previously denied browser/socket route was not retried or bypassed. On the target device, try ±5 seconds near both clip ends while paused and playing, hold and reverse either stick during loading, reorder the queue, use a progress bar during pending duration resolution, and test confirmed/unconfirmed browser clips and a deliberately unsupported file. Confirm that audio follows the requested position, view/zoom/mirror remain unchanged, and the first/last playlist entries do not wrap.


## Desktop fullscreen transport dock — 2026-11-07

The existing live transport, viewer actions and compact playlist move into a bottom dock only while the viewer is fullscreen. Original nodes/listeners and DOM positions are restored on exit. The playlist modal stays outside the idle dock. There is no duplicate playback state, decoder, clock, media source or XR panel. This also applies to a computer-hosted desktop mirror during XR.

The dock hides after 2000 ms without interaction, independent of playing/paused state. While hidden, pointer movement within 48 CSS pixels of its top or inside its area reveals it; viewer tap/click and keyboard input also reveal it. Keyboard/assistive focus, held control pointers and the playlist modal prevent hiding. Pointer-click focus, including label and button-child activation, does not permanently pin controls; focus returns to the viewer before pointer-focused controls hide. Input never prevents native slider/button behavior or consumes Escape. Pointer cancellation/lost capture, released buttons, multi-pointer scrubs, blur, page visibility, persisted back/forward restoration, repeated fullscreen transitions and disposal have deterministic coverage.

Local validation: **374/374 Node tests passed**, all source/test JavaScript syntax checks and `git diff --check` passed. Seventeen added tests use synthetic DOM events and fake timers; existing app transport/native/browser/VR suites still pass. No private footage or derived previews were used. Real browser fullscreen layout/compositing, native form focus behavior and physical headset output still need target-device validation. No previously denied browser/socket path was retried.

Target-device check: enter fullscreen with mouse and keyboard; test Play/Pause, seek, mute, volume, Previous/Next and Browse playlist while paused and playing. Verify exactly two-second idle behavior after pointer clicks, bottom proximity, touch reveal, keyboard Tab focus, long slider drags, Escape, narrow windows and repeated entry/exit. On a computer-hosted headset, repeat while mirroring and confirm the monitor controls stay separate from the headset panel. Navigate away/back, switch tabs, then ensure the dock remains usable.

Fullscreen modal interruption follow-up: close an open playlist dialog before any fullscreen reparent, including external fullscreen exit, entry and disposal. This avoids leaving `open` set after the browser removes modal top-layer membership. Focus returns to Browse playlist (or the fullscreen action) rather than a now-hidden dialog control. Synthetic regressions emulate the modal-removal behavior and verify reopening remains modal; normal-page disposal does not close an unrelated playlist. The full 374-test suite, source/test syntax checks and diff checks pass.

## Flat browser video (2026-11-07)

Browser-native MP4 and other compatible containers now use flat 2D playback automatically. Browser equirectangular/360 MP4 selection is removed. Original `.360` files retain native MAX routing; dual-track MP4 files no longer opt into native decoding, and gallery thumbnail routing follows the same distinction. Non-ISO containers can reach browser decoding, bounded next-clip preparation, and metadata-only duration seeking.

Verification: `npm test` passes 373/373 tests. `node --check` passes for every source/test module, and `git diff --check` is clean. Synthetic unit/mock coverage includes portrait/landscape aspect preservation, finite distance limits, common world-plane placement with per-eye origins/projections and mirrored-eye coherence, flat-only pan/tilt/grip suppression, distance-only zoom, stick-click/reset placement after translation/rotation, deferred reset during tracking loss, VR reentry, mode changes, audio preferences, unsupported media and missing WebGL failures, mixed playlist seeking and bounded preparation. Tests enforce that browser video has no 360 projection override and renamed MAX-shaped MP4 is treated as browser media.

No private footage, browser playback, local browser/server execution, or physical headset testing was used for this change. Real GPU shader compilation, actual container/codec compatibility, headset stereo comfort/interaction, and device performance remain unverified. The previously documented local-browser route restriction was not retried. The supported browser environment does not provide WebGL, so this is not a browser visual sign-off.

## Combined flat-video and fullscreen release — 2026-11-07

The final integration passes **390/390 Node tests** on Node 24.22.1, syntax checks for every source/test JavaScript file, and `git diff --check`. Independent review of the combined code found no remaining concrete blockers after fixes for keyboard entry focus, back/forward restoration, and open playlist dialogs during fullscreen reparenting. Shared app imports, DOM ids, flat/panorama help and both feature test sets were checked after conflict resolution.

This release supersedes older descriptions of browser equirectangular playback and projection confirmation: browser-decoded media is flat only, including MP4, while native MAX projection is restricted to original `.360` files. The generated panorama demo remains available. The fullscreen dock also works on the monitor during computer-hosted XR mirroring and uses the same live controls, without duplicating transport state or affecting the headset panel.

All verification media and interfaces are synthetic or mocked. No private clips, frames, previews or diagnostics were published. Real GPU shader compilation, browser codec support/fullscreen layout and physical-headset playback remain unverified; no previously denied browser/server route was retried. Target-device acceptance should cover a non-private browser-decodable flat clip, native `.360`, distance zoom and stick-click recenter after head motion, flat/panorama transitions, fullscreen idle/proximity/focus, external fullscreen exit with the playlist open, and monitor mirroring.

## Documentation reorganization (2026-11-11)

- Replaced the README with a short setup, compatibility and controls guide. Moved detailed behavior to PLAYER_GUIDE.md and engineering details to DEVELOPMENT.md; added HISTORY.md and AGENTS.md.
- `npm test`: **390/390 passed**, Node v24.22.1.
- `git diff --check`: passed. All relative links in the new/rewritten documentation resolve to repository files. History links use commit IDs verified in the local Git history.
- Checked README UI labels against index.html, native dimensions against src/native-demux.js, and setup/test commands against package.json.
- Documentation-only changes. No new browser, HEVC, GPU or physical-headset validation was performed. Earlier verification entries remain historical records, including references to superseded projection behavior.
