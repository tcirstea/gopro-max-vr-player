# Native MAX audio — experimental

## Supported tracks

- **Stereo/mono:** MPEG-4 AAC-LC with a matching AudioSpecificConfig, sound entry and sample rate. Decode uses WebCodecs `AudioDecoder` after an actual configuration-support check. AAC support is independent of HEVC support.
- **Spatial headphones:** original MAX `in32` signed 32-bit little-endian PCM, with explicit `wave/enda` endianness and **SA3D v0, first-order periphonic, ACN/SN3D, identity channel mapping**. The channel sequence is W,Y,Z,X. Four channels or a track label alone never qualify as ambisonics.
- Unknown codecs, spatial metadata conventions, other mappings, PCM packet layouts and complex edit lists are rejected for audio without rejecting otherwise supported video. AAC single-rate edit trims are honored. Audio defaults to stereo when supported; use the mode selector for spatial headphones. Mute starts enabled.

Stereo is **head-locked**, not fake surround. Spatial mode sends a first-order max-rE cube decode to eight Web Audio HRTF virtual speakers. The same final camera-to-source rotation used for panorama rendering, including drag, headset orientation and available stabilization, updates the audio listener. Translation is ignored. This is an experimental binaural approximation, not discrete 5.1/7.1 speaker output or a calibrated headphone renderer. Conservative gain leaves headroom; this is not a limiter.

## Synchronization and lifecycle

Audio uses the MP4 track timestamps, not independently started playback of a second video element. AAC seek preroll decodes two preceding packets and discards audio before the requested media time. PCM is converted directly to planar float audio without a codec, export step or whole-track decode.

When available, the Web Audio clock drives the video timeline. Scheduling is bounded by **paired video availability**, decoded audio availability, the common video duration, and a 150 ms scheduling horizon. Audio cannot continue to the end while video is stuck on a frame. A long animation-frame interruption drains only the already scheduled horizon, then playback reanchors rather than rushing through the clip. Play requires the user gesture to resume the audio context; pause, seek, track changes, decoder failure and source closure stop scheduled sources. Muting changes output gain without running a different timeline.

The active desktop or immersive-XR render loop advances native playback; it does not depend on window animation callbacks continuing during immersion. The two video tracks determine playback duration. A longer audio track is clipped at that endpoint; a shorter audio track produces silence for the remaining video rather than ending the video early. Audio failure falls back to video-only and is exposed in diagnostics. A suspended audio context preserves its actual elapsed media time before buffering, rather than rewinding to the preceding video tick. Video-decoder failure closes audio too.

## Bounds and privacy

- Audio reads reuse the same shared small-file buffer / 64 MiB chunk cache as video. The existing **256 MiB cached-plus-in-flight compressed-input ceiling** remains in place; the budget is not a total process-memory bound.
- Compressed AAC has at most 24 outstanding decoder inputs. Decoded audio plus pending inputs is bounded; the scheduler retains about one second of decoded media, not the whole recording. PCM packets are grouped to at most 4096 frames each, avoiding per-frame objects for a long PCM track.
- Shared-cache demand eviction can replace an inactive old-current audio region; active sample reads remain protected. At most two physical chunk reads run simultaneously. Telemetry uses its own small bounded exact-read cache.
- Playback diagnostics v6 includes only technical audio mode, format, clock, scheduling, queue and failure-status counters. No audio samples, footage, filenames, paths, raw metadata or automatic uploads.

## Evidence and remaining gates

Demux verification compares packet offsets, byte sizes, timestamps and durations against an independent parser such as ffprobe, checks explicit SA3D metadata, and exercises interleaved video/audio reads through the shared cache. Such checks establish container/read behavior, **not real-time decode, acoustic alignment, headphone localization or hardware performance**. Private recordings, derived measurements and extracted metadata are not part of the published evidence.

Synthetic tests cover channel/axis mapping, packet tables, edit trimming, stale output, seek/pause/close, bounded scheduling, muted clocks, audio/video starvation and cache contention. Actual HEVC/AAC WebCodecs playback, browser audio-device latency, perceptual A/V alignment, and head-relative headphone listening still require a supported browser/device. Workspace Chromium failed before loading the application because socket creation was denied. Physical headset behavior remains untested.

## Primary references

- [Google Spatial Audio RFC](https://github.com/google/spatial-media/blob/master/docs/spatial-audio-rfc.md): explicit SA3D channel ordering/normalization and coordinate semantics.
- [W3C AAC WebCodecs registration](https://www.w3.org/TR/webcodecs-aac-codec-registration/): AAC configuration and encoded chunks.
- [W3C WebCodecs](https://www.w3.org/TR/webcodecs/): media presentation timestamps and decoded AudioData.
- [W3C Web Audio](https://www.w3.org/TR/webaudio/): scheduled buffer sources, channel routing, listener orientation and HRTF panners.
