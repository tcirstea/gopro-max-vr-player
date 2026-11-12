# GoPro MAX VR player

**[Open the player](https://tcirstea.github.io/gopro-max-vr-player/)**

Play original GoPro MAX `.360` videos in your browser without exporting them first. You can also watch ordinary videos on a flat screen, on your desktop or in VR.

Files stay on your device. There are no uploads, accounts or runtime dependencies. This is an independent project, not affiliated with GoPro.

Native MAX files work and have been tested in the browser and in VR through **Quest Link on Windows**. Performance directly in the standalone Quest browser has not been tested.

## Get started

Use the [hosted player](https://tcirstea.github.io/gopro-max-vr-player/) with no installation, or run it locally with Node 22+ and Python 3. No `npm install` is needed.

```sh
npm start
```

Open [localhost:8000](http://localhost:8000), then:

1. Choose **Explore demo** to try the generated panorama, or **Open local videos** to select your files.
2. Press **Play**. The first selected video opens paused.
3. Uncheck **Muted** if you want sound. Each page load starts muted.
4. Choose **Full screen**, or **Enter VR** if your browser supports an immersive headset session.

## Supported videos

- **Original GoPro MAX `.360`:** 360° playback, stereo or supported spatial headphone audio, and relative-orientation stabilization. Requires WebCodecs with HEVC support. The native reader accepts two 4096×1344 HEVC video tracks; MAX2 support is not claimed.
- **Ordinary videos:** MP4, WebM, Ogg and other formats your browser can decode. These play as flat video, including on a screen in VR. Codec support depends on your browser, operating system and hardware.
- **Demo:** a generated panorama that needs no camera footage.

360° MP4/equirectangular playback, export and transcoding are not supported. Keep original MAX files as `.360`; renaming one to `.mp4` sends it to the flat-video player.

WebGL is required. Native playback and VR require HTTPS or localhost, and VR also needs a compatible headset and WebXR browser. A successful capability check does not guarantee smooth playback.

## Everyday controls

**Desktop**

- Space: play/pause. Left/Right: seek five seconds, including across videos in the playlist.
- Left-drag: look around a panorama. Right-drag horizontally: roll it. Up/Down: tilt it.
- Scroll or +/−: zoom. Middle-click: reset zoom. **Reset view** also recenters the view.
- In fullscreen, controls hide after two seconds of inactivity. Move near the bottom, click the viewer or press Tab to show them.

Shortcuts leave form fields and dialogs alone. Pan, roll and tilt apply to panoramas, not flat video.

**Quest controllers**

- A/X: play/pause. Either stick left/right: seek five seconds.
- Either stick forward/back: zoom a panorama or move the flat screen closer/farther.
- Click either stick: reset panorama zoom, or place the flat screen in front of you.
- Hold a side grip and move/rotate the controller: reposition a panorama.
- B/Y or an index trigger: show controls. Point and use the trigger to select; release the opening trigger press before selecting.

See the [player guide](PLAYER_GUIDE.md) for the full controls and settings.

## Playlists and settings

Select multiple files to make a local playlist. **Browse playlist** offers sorting, list/grid views and locally generated previews. Sorting changes playback order. The next video starts automatically at the end of a clip when browser permissions allow; transitions may have gaps.

**Experimental settings** contains native audio options, thumbnail settings and an optional desktop headset mirror. The mirror only works when that computer is running the VR session. It does not cast a standalone Quest to another computer, and people at the monitor can see the video and visible playlist details.

If native playback buffers repeatedly, use **Save playback diagnostics**. It downloads technical counters without footage, audio, filenames or paths. Nothing is sent automatically.

## More information

- [Player guide](PLAYER_GUIDE.md): detailed controls, playlists, audio preferences and mirroring.
- [Development](DEVELOPMENT.md): tests, code map, hosting, diagnostics and technical limits.
- [Audio](AUDIO.md), [stabilization](STABILIZATION.md) and [renderer](MAX_RENDERER.md): implementation details.
- [Verification](VERIFICATION.md): recorded checks and remaining device-testing gaps.
- [History](HISTORY.md): development milestones.
- [Third-party notices](THIRD_PARTY_NOTICES.md): attribution and licenses.
