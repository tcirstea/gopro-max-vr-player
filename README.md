# 360° GoPro VR player — kickoff prototype

A static, local-first starting point for viewing original **GoPro MAX** `.360` files without exporting first.

**Native `.360` playback is not implemented yet.** This version safely inspects camera originals and provides a working equirectangular viewer to establish the rendering/UI foundation. The generated demo is not GoPro footage. This is independent software, not affiliated with GoPro.

## What is implemented

- Local file selection; **no video uploads**, backend, third-party scripts or runtime dependencies.
- Bounded ISO-BMFF/MP4 inspection of track type, codec and dimensions. Video payloads are skipped; metadata is limited to 16 MiB.
- `.360` and multi-video-track detection, explicitly routed away from the equirectangular renderer.
- User-confirmed, browser-decodable equirectangular MP4 playback through a WebGL panoramic viewer.
- Drag / arrow-key navigation, scroll or +/- zoom, reset view, playback, seek, mute and full screen.
- Synthetic panorama demo, responsive layout and capability hints.
- Tests and GitHub Pages deployment workflow.

## Run locally

Requires Node 22+ for tests and Python 3 for the static server. No npm install is needed.

```sh
npm test
npm start
# Open http://localhost:8000
```

For an exported video, open the file, then explicitly choose **View as equirectangular video**. Select only stitched equirectangular material (normally 2:1); projection cannot reliably be inferred from dimensions alone. Browser decoding depends on codec, OS and hardware. No transcoding fallback is included.

## GitHub Pages

Create a repository, push these files to its `main` branch, then select **Settings → Pages → Source → GitHub Actions**. The included workflow runs tests before deploying only `index.html` and `src/`. Relative URLs support repository project pages. Pull requests run tests without deploying.

The source is publication-ready scaffolding, not a claim that a repository or deployment already exists. Do not commit camera originals; common video extensions are ignored. HTTPS is supplied by GitHub Pages and will be necessary for future WebXR/WebCodecs work.

## Native MAX roadmap

Original MAX `.360` files are not ordinary equirectangular videos. Their multiple HEVC tracks and GoPro-specific cube-face packing/overlap require a dedicated reconstruction path. GoPro already performs in-camera stitching; that does not make the stored frames directly displayable as equirectangular video.

1. **Fixture and format validation:** inspect a real original MAX sample; record track IDs, codec configuration, timing, packing, overlap and orientation. Keep private footage out of Git. Add tiny synthetic format fixtures where possible.
2. **Demux / decode spike:** evaluate MP4Box.js + WebCodecs with paired HEVC decoder configuration. Verify support using actual codec configs, not generic MIME hints. Synchronize timestamps, seek to keyframes, handle backpressure, and close all VideoFrames. Explore browser-native decoding or a local fallback only after measured compatibility.
3. **Projection shader:** map the two decoded track textures into spherical directions with validated face layout, rotation, overlap removal and seams. Do not assume MAX2 compatibility. Compare against GoPro Player export and known landmarks.
4. **Performance:** test full resolution and large local files, GPU texture limits, memory, audio sync and mobile thermal behavior. Avoid whole-file reads.
5. **WebXR:** add `immersive-vr` session entry, per-eye projection and head orientation while ignoring headset translation for a fixed panorama. Test real headsets/controllers; current full screen is **not** headset VR.
6. **Release gate:** actual native playback, seeking and repeated open/close verified on a documented browser/OS/device matrix before advertising direct `.360` support.

References for the next investigation:
- [GoPro: MAX stitching and resolution](https://gopro.com/en/dm/news/max-tech-specs-stitching-resolution)
- [Trek View max2sphere reference implementation](https://github.com/trek-view/max2sphere/blob/main/max2sphere.c) (review its Apache-2.0 license before reuse)
- [FFmpeg projection patch discussion](https://ffmpeg.org/pipermail/ffmpeg-devel/2024-September/333649.html) (reference only; do not copy code without license review)

## Known limits

No native MAX decode, headset VR, export, transcoding or device-motion control yet. No real GoPro sample was used for the initial implementation. Metadata inspection is deliberately small and conservative, not a general MP4 demuxer. Generic browser HEVC hints are not guarantees. Large or malformed metadata is rejected rather than loaded without bounds. The viewer requires WebGL; on context loss it asks for a reload. Verify target browser decoding and graphics limits before relying on a clip.
