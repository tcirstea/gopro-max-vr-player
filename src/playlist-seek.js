// Resolve transport offsets in the actual queue, never a separately sorted view.
import {inspectFile} from './inspect.js';
import {demuxNative} from './native-demux.js';

function checkAbort(signal) {
  if (signal?.aborted) throw new DOMException('Playlist seek canceled.', 'AbortError');
}
function validDuration(duration) {
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0) {
    throw new Error('The clip duration is unavailable or invalid.');
  }
  return duration;
}

export async function resolvePlaylistSeek(items, index, time, {getDuration, signal} = {}) {
  checkAbort(signal);
  if (!Array.isArray(items) || !items.length || !Number.isInteger(index) || index < 0 || index >= items.length) {
    throw new RangeError('A valid playlist and current index are required.');
  }
  if (!Number.isFinite(time)) throw new RangeError('Seek time must be finite.');
  if (typeof getDuration !== 'function') throw new TypeError('A duration reader is required.');
  const durationAt = async i => {
    checkAbort(signal);
    let duration;
    try { duration = await getDuration(items[i]); }
    catch (error) { checkAbort(signal); throw error; }
    checkAbort(signal);
    return validDuration(duration);
  };
  let duration = await durationAt(index);
  // A negative target is measured backwards from this clip's beginning.
  while (time < 0 && index > 0) {
    duration = await durationAt(--index);
    time += duration;
  }
  time = Math.max(0, time);
  // Exact positive endpoints belong to the next clip. Moving the index even
  // for zero-duration entries guarantees termination without wrapping.
  while (time >= duration && index < items.length - 1) {
    time -= duration;
    duration = await durationAt(++index);
  }
  checkAbort(signal);
  return {index, time: Math.min(time, duration), duration};
}

function browserDuration(file, signal) {
  checkAbort(signal);
  if (typeof document === 'undefined') throw new Error('Browser video metadata is unavailable.');
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    let url, timer, finished = false;
    const finish = (error, duration) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      video.removeEventListener('loadedmetadata', loaded);
      video.removeEventListener('error', failed);
      // Clearing the source releases the detached element's local media load.
      try { video.removeAttribute('src'); video.load(); } catch { /* Still revoke. */ }
      if (url !== undefined) URL.revokeObjectURL(url);
      if (error) reject(error); else resolve(duration);
    };
    const abort = () => finish(new DOMException('Playlist seek canceled.', 'AbortError'));
    const failed = () => finish(new Error('Could not read this clip’s playable duration.'));
    const loaded = () => {
      try { checkAbort(signal); finish(null, validDuration(video.duration)); }
      catch (error) { finish(error); }
    };
    signal?.addEventListener('abort', abort, {once: true});
    video.addEventListener('loadedmetadata', loaded);
    video.addEventListener('error', failed);
    if (signal?.aborted) { abort(); return; }
    timer = setTimeout(() => finish(new Error('Timed out reading the clip duration.')), 10000);
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    try { url = URL.createObjectURL(file); video.src = url; video.load(); }
    catch (error) { finish(error); }
  });
}

export async function readPlaylistSeekDuration(file, {signal} = {}) {
  checkAbort(signal);
  let movie;
  try {
    const inspection = await inspectFile(file,{allowBrowser:true});
    checkAbort(signal);
    if (!inspection.nativeCandidate) return await browserDuration(file, signal);
    // Demux only builds sample tables. Do not prepare inputs, read samples,
    // allocate decoders, or substitute mvhd's possibly different duration.
    movie = await demuxNative(file);
    checkAbort(signal);
    return validDuration(movie.duration);
  } catch (error) {
    checkAbort(signal);
    throw error;
  } finally {
    // Blob metadata reads cannot be interrupted, but any late movie is closed.
    movie?.close();
  }
}
