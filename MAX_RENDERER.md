# Original MAX renderer integration

`createRenderer(canvas)` retains the equirectangular `setSource`, `refresh`, and
`reset` API. For paired decoded original MAX video frames:

```js
renderer.setMaxSources(frame0, frame1);
frame0.close();
frame1.close();
```

Both GPU uploads are synchronous. The renderer never owns or retains these
VideoFrames. Supply synchronized frames in video-track order: front strip first,
back strip second. Only **4096×1344** and **2272×736** layouts are accepted.
`{width,height}` overrides are available for preview/testing with rescaled source
images; real decoder frames should use their own display dimensions.

Faces use equiangular cube mapping, not equirectangular or dual-fisheye mapping.
The second strip is rotated 90°. Four side faces blend duplicated overlap pixels
inside each strip, using the max2sphere equations (see third-party notices).
This does not decode gyro metadata, stabilize, horizon-level, or implement optical
flow. Orientation and visual quality remain experimental.

`enterVR()` requests an immersive WebXR session. The renderer also wires a `#vr`
button if present, enables it only when `isSessionSupported('immersive-vr')`
returns true, renders per-eye asymmetric projections, and uses headset pose for
rotation. Content is monoscopic; both eyes share the same panorama. Requires
HTTPS/localhost and a supporting browser/headset. No physical-headset validation
has been performed. Canvas drag yaw remains an optional recenter offset; camera
translation is intentionally ignored for an infinitely distant panorama.

## Verification

`node --test test/max-projection.test.js`: six tests cover templates, face and
track selection, overlap coordinates/weights, sphere-wide texture bounds,
invalid directions, and asymmetric projection-matrix inversion.

Local browser shader/pixel
QA was attempted but blocked by sandbox Chromium socket restrictions. An
escalated local HTTP server also failed with an infrastructure bwrap error.
Therefore these unit tests are **not** evidence of successful GPU, native HEVC,
or headset playback. Verify those on a supported real browser before release.
