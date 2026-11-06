// Local-only playlist inspection. File.lastModified is NOT a creation date.
import {readMovie, children, descend} from './inspect.js';
import {readGoProInfo} from './gopro-info.js';
import {demuxNative, createSampleReader} from './native-demux.js';
const QUICKTIME_EPOCH_SECONDS = 2082844800;
const THUMBNAIL_SIZE = 320;
const TIMEOUT_MS = 10000;

function embeddedDate(view, box) {
  if (!box || box.start + 8 > box.end) return null;
  const version = view.getUint8(box.start);
  if (version > 1 || (version === 1 && box.start + 12 > box.end)) return null;
  const seconds = version === 1 ? Number(view.getBigUint64(box.start + 4)) : view.getUint32(box.start + 4);
  if (!seconds || !Number.isSafeInteger(seconds)) return null;
  const date = (seconds - QUICKTIME_EPOCH_SECONDS) * 1000;
  // Zero/epoch dates and implausible camera timestamps are not useful capture dates.
  return date >= Date.UTC(1970, 0, 1) && date <= Date.now() + 86400000 ? date : null;
}

function mediaDuration(view, box) {
  if (!box || box.start + 20 > box.end) return null;
  const version = view.getUint8(box.start);
  if (version > 1 || (version === 1 && box.start + 32 > box.end)) return null;
  const scale = view.getUint32(box.start + (version ? 20 : 12));
  const ticks = version ? Number(view.getBigUint64(box.start + 24)) : view.getUint32(box.start + 16);
  return scale && Number.isSafeInteger(ticks) && ticks > 0 ? ticks / scale : null;
}

export async function readPlaylistMetadata(file) {
  const result = {dateTaken: null, dateTakenSource: null, fileCreated: null,
    cameraModel: null, cameraFirmware: null, duration: null, videoTracks: [], nativeCandidate: false};
  try {
    const {moov} = await readMovie(file);
    const boxes = children(moov, 0, moov.byteLength);
    const movie = boxes.find(b => b.type === 'mvhd');
    // Static metadata only. Timed GPMF (including GPS) is not scanned for the gallery.
    for (const userData of boxes.filter(b => b.type === 'udta')) {
      try {
        const gpmf = children(moov, userData.start, userData.end).find(b => b.type === 'GPMF');
        const camera = readGoProInfo(moov, gpmf);
        for (const key of ['cameraModel', 'cameraFirmware']) if (camera[key] !== null) result[key] = camera[key];
      } catch { /* Malformed optional user data does not hide usable media info. */ }
    }
    result.dateTaken = embeddedDate(moov, movie);
    if (result.dateTaken !== null) result.dateTakenSource = 'Embedded movie creation time (timezone unverified)';
    result.duration = mediaDuration(moov, movie);
    for (const track of boxes.filter(b => b.type === 'trak')) {
      // A malformed optional track must not suppress other available file info.
      try {
        const media = descend(moov, track, ['mdia', 'mdhd']);
        const mediaDate = embeddedDate(moov, media);
        if (result.dateTaken === null && mediaDate !== null) {
          result.dateTaken = mediaDate; result.dateTakenSource = 'Embedded media creation time (timezone unverified)';
        }
        const handler = descend(moov, track, ['mdia', 'hdlr']);
        if (!handler || handler.start + 12 > handler.end || moov.getUint32(handler.start + 8) !== 0x76696465) continue;
        const stsd = descend(moov, track, ['mdia', 'minf', 'stbl', 'stsd']);
        const entry = stsd && stsd.start + 8 <= stsd.end ? children(moov, stsd.start + 8, stsd.end)[0] : null;
        if (!entry || entry.start + 28 > entry.end) continue;
        result.videoTracks.push({codec: entry.type, width: moov.getUint16(entry.start + 24), height: moov.getUint16(entry.start + 26)});
        result.duration ??= mediaDuration(moov, media);
      } catch { /* Keep metadata from the other tracks. */ }
    }
    result.nativeCandidate = result.videoTracks.length === 2 && result.videoTracks.every(t => ['hvc1', 'hev1'].includes(t.codec) && t.width === 4096 && t.height === 1344);
  } catch { /* Unsupported or malformed metadata stays unknown. */ }
  return result;
}

function snapshot(source, width, height) {
  if (!width || !height || typeof document === 'undefined') return null;
  const scale = Math.min(1, THUMBNAIL_SIZE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function browserThumbnail(file, signal) {
  return new Promise(resolve => {
    const video = document.createElement('video');
    let url = null, finished = false;
    const finish = result => {
      if (finished) return;
      finished = true;
      signal.removeEventListener('abort', abort);
      video.onloadedmetadata = video.onloadeddata = video.onseeked = video.onerror = null;
      video.pause();
      video.removeAttribute('src');
      video.load();
      if (url) URL.revokeObjectURL(url);
      resolve(result);
    };
    const abort = () => finish(null);
    const capture = () => {
      if (video.readyState < 2) return;
      try { finish(snapshot(video, video.videoWidth, video.videoHeight)); } catch { finish(null); }
    };
    signal.addEventListener('abort', abort, {once: true});
    if (signal.aborted) return abort();
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.onerror = abort;
    video.onloadedmetadata = () => {
      const middle = Number.isFinite(video.duration) && video.duration > 0 ? video.duration / 2 : 0;
      video.onseeked = capture;
      video.onloadeddata = () => { if (!video.seeking) capture(); };
      try { video.currentTime = middle; } catch { capture(); }
    };
    try { url = URL.createObjectURL(file); video.src = url; video.load(); } catch { finish(null); }
  });
}

async function nativeThumbnail(file, signal) {
  if (typeof VideoDecoder === 'undefined' || typeof EncodedVideoChunk === 'undefined') return null;
  let movie = null, decoder = null, reader = null;
  let stop = () => {};
  const abort = () => { if (decoder && decoder.state !== 'closed') decoder.close(); stop(null); };
  signal.addEventListener('abort', abort, {once: true});
  try {
    movie = await demuxNative(file);
    if (signal.aborted) return null;
    const track = movie.tracks[0];
    const config = {...track.config, optimizeForLatency: true};
    const support = await VideoDecoder.isConfigSupported(config);
    if (!support.supported || signal.aborted) return null;
    // One independently decodable frame, choosing the sync sample closest to midpoint.
    const target = track.duration * 500000;
    const sample = track.samples.reduce((best, item) => item.key && (!best || Math.abs(item.timestamp - target) < Math.abs(best.timestamp - target)) ? item : best, null);
    if (!sample) return null;
    reader = createSampleReader(file, 0);
    const data = await reader.read(sample);
    if (signal.aborted) return null;
    return await new Promise(resolve => {
      let settled = false;
      stop = result => { if (!settled) { settled = true; resolve(result); } };
      decoder = new VideoDecoder({
        output(frame) {
          try { if (!settled && !signal.aborted) stop(snapshot(frame, frame.displayWidth, frame.displayHeight)); }
          catch { stop(null); }
          finally { frame.close(); }
        },
        error() { stop(null); }
      });
      try {
        decoder.configure(config);
        decoder.decode(new EncodedVideoChunk({type: 'key', timestamp: sample.timestamp, duration: sample.duration, data}));
        decoder.flush().then(() => stop(null), () => stop(null));
      } catch { stop(null); }
    });
  } catch { return null; }
  finally {
    signal.removeEventListener('abort', abort);
    if (decoder && decoder.state !== 'closed') decoder.close();
    reader?.clear();
    movie?.close();
  }
}

// Call sequentially while playback is paused; abort on play/removal/navigation.
// A timeout or abort returns null, so callers can retain their neutral placeholder.
export async function createPlaylistThumbnail(file, {signal, generate = false, metadata} = {}) {
  if (!generate || signal?.aborted || typeof document === 'undefined') return null;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, {once: true});
  let timer, finishAbort;
  const stopped = new Promise(resolve => {
    finishAbort = () => resolve(null);
    controller.signal.addEventListener('abort', finishAbort, {once: true});
    timer = setTimeout(abort, TIMEOUT_MS);
  });
  try {
    const native = metadata?.nativeCandidate || /\.360(?:\.mp4)?$/i.test(file.name || '');
    const task = native ? nativeThumbnail(file, controller.signal) : browserThumbnail(file, controller.signal);
    const thumbnail = await Promise.race([task, stopped]);
    if (thumbnail) thumbnail.thumbnailSource = native ? 'Generated native keyframe near midpoint (unstitched)' : 'Generated midpoint frame';
    return thumbnail;
  } catch { return null; }
  finally {
    clearTimeout(timer);
    controller.abort();
    controller.signal.removeEventListener('abort', finishAbort);
    signal?.removeEventListener('abort', abort);
  }
}
