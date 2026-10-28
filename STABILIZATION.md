# Original MAX orientation stabilization

The native pipeline uses embedded **CORI + IORI quaternions**, not an uncalibrated integration of raw GYRO samples. It rotates the sampling ray before EAC projection, leaving the original frames untouched. The first encoded frame is the reference orientation; this removes camera rotation while preserving the starting view and tilt. It is **not gravity-based horizon leveling**.

## Timing and conventions

- GoPro describes CORI as camera orientation since capture start and IORI as image orientation relative to the body. Both are frame-rate streams. [GoPro GPMF documentation](https://github.com/gopro/gpmf-parser/blob/main/docs/README.md).
- A GoPro collaborator confirms one orientation sample per encoded frame: first sample → first frame. STMP is not a video presentation offset. TSMP identifies the frame ordinal within packetized metadata. In particular, do not distribute the final orientation samples over a padded final metadata-packet duration. [GoPro timing clarification](https://github.com/gopro/gpmf-parser/issues/125).
- Our shader uses right-handed viewer coordinates: X right, Y up, −Z forward. Quaternions are scalar first. With raw telemetry `C=CORI`, `I=IORI`, the sampling rotation is `S=B(I*C)`, where `B(w,x,y,z)=(w,x,-y,-z)`. Stabilization relative to the first frame is `S(t)*inverse(S(0))`.
- The nonidentity IORI composition is an algebraic translation of telemetry-parser’s camera-orientation calculation (negated raw X, then CORI × IORI), inverted for sampling rays. It is not copied implementation code. [Primary implementation reference](https://github.com/AdrianEddy/telemetry-parser/blob/master/src/gopro/mod.rs).

The same final camera-to-source matrix is exposed to the local ambisonic listener. Desktop panning and WebXR head orientation are applied before the source-space correction, so moving your view still works.

## Bounds and lifecycle

Only orientation fields are retained; GPS and other camera identifiers are not returned or included in playback diagnostics. GPMF reads are local and lazy, with a 1 MiB packet ceiling, at most two pending reads, and four cached parsed packets. These small metadata reads are separate from the shared compressed video/audio cache. No whole-recording telemetry scan is needed at startup.

Malformed, absent, unsupported, or non-frame-aligned telemetry disables this correction and records a technical reason rather than breaking video playback. Nonzero metadata edit offsets are unsupported. Seek uses the original first-frame reference, not a new reference, avoiding a view reset on every seek. Canceled input reads can be retried. Close prevents late input from repopulating the cache.

## Verification and limits

Orientation validation can compare decoded EAC scene regions across candidate quaternion axis/sign mappings and nearby frame offsets. This is a local CPU methodology, **not a general stabilization-quality score or browser-performance benchmark**. Translation, independently moving objects, stitching differences, rolling shutter, and motion blur remain; camera-fixed foreground cannot be stabilized with the distant world. Private footage, derived images, per-recording measurements and extracted telemetry are not published.

The optional `node scripts/verify-stabilization.mjs /private/path/to/clip.360` check reads a local recording and prints technical coverage/cache counters, not filenames or raw telemetry. It does not decode video.

Synthetic tests cover GPMF bounds/scaling, noncommuting CORI/IORI composition, quaternion math, frame-ordinal timing, padded final packets, chapter-counter baselines, lazy caching, repeated seeks, cancellation, missing metadata, and close during pending reads. Real nonidentity IORI, other capture modes/firmware, GPU shader execution, and headset stabilization still need target-device verification. The local Chromium smoke test could not launch in the execution environment; unit and CPU image checks do not substitute for real browser/headset playback.
