# Initial verification — 2026-10-28

## Passed

- `npm test`: 11/11 tests (Node 24.22.1).
- `node --check src/app.js`, `src/renderer.js`, `src/inspect.js`.
- Parser tests cover single and dual video tracks, native extension detection, codec/dimensions, ftyp, skipping media data, truncated/invalid boxes, absent metadata, extended and zero-sized boxes, oversized metadata, malformed sample entries and safe time formatting.
- Source review: local Blob URLs only for video; no fetch/upload path or runtime CDN dependency. CSP disables network connections and limits media to Blob URLs.

## Not yet verified

- Actual browser rendering, playback, seeking, fullscreen and mobile layouts.
- Native camera sample parsing, HEVC decoding or GoPro projection reconstruction.
- GitHub Actions execution and live Pages deployment.
- Headset WebXR (not implemented).

Browser QA was attempted. The workspace Chromium launch failed because the sandbox denied socket creation. An escalated launch failed during sandbox setup with a read-only filesystem error. The connected browser did not reach the workspace static server: localhost:8000 served an unrelated authentication service, and localhost:8765 refused the connection. These are test-environment failures, not evidence of a passing or failing UI.

## Next manual/browser checks

1. Run the static server on the browser's machine; load the generated panorama and check console errors.
2. Drag, use arrow keys, scroll and +/- zoom; reset repeatedly. Check touch drag and narrow-screen layout.
3. Open a known stitched 2:1 browser-decodable video; confirm projection, play/pause, mute, seek while paused/playing and end-of-file replay.
4. Switch clips rapidly, re-open the same clip, select a corrupt file, then return to demo. Ensure stale inspection results cannot replace the latest selection.
5. Select original MAX .360 and renamed dual-track MP4. Verify inspection only and explicit native-not-supported messaging.
6. Enter/exit fullscreen; test WebGL unavailable/context-loss behavior.
7. Verify the final public URL at its repository subpath and test in target browsers before announcing availability.
