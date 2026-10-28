// Bounded ISO-BMFF inspection: read box headers, never load video payloads.
const MAX_MOOV = 16 * 1024 * 1024;
const MAX_BOXES = 10000;
const ascii = (v, o, n) => String.fromCharCode(...new Uint8Array(v.buffer, v.byteOffset + o, n));
function header(v, offset, limit) {
  if (offset + 8 > limit) throw new Error('Truncated MP4 box header.');
  let size = v.getUint32(offset), bytes = 8;
  const type = ascii(v, offset + 4, 4);
  if (size === 1) {
    if (offset + 16 > limit) throw new Error('Truncated extended MP4 box.');
    size = Number(v.getBigUint64(offset + 8)); bytes = 16;
  } else if (size === 0) size = limit - offset;
  if (!Number.isSafeInteger(size) || size < bytes) throw new Error('Invalid MP4 box size.');
  return {type, size, bytes};
}
function children(v, start, end) {
  const result = []; let offset = start;
  while (offset < end) {
    if (result.length >= MAX_BOXES) throw new Error('Too many MP4 boxes.');
    const b = header(v, offset, end);
    if (offset + b.size > end) throw new Error('MP4 box exceeds its container.');
    result.push({...b, start: offset + b.bytes, end: offset + b.size}); offset += b.size;
  }
  return result;
}
function descend(v, parent, path) {
  let box = parent;
  for (const type of path) {
    box = children(v, box.start, box.end).find(b => b.type === type);
    if (!box) return null;
  }
  return box;
}
export async function inspectFile(file) {
  let offset = 0, count = 0, moov = null, brand = null;
  while (offset < file.size) {
    if (++count > MAX_BOXES) throw new Error('Too many top-level MP4 boxes.');
    const buf = await file.slice(offset, Math.min(offset + 32, file.size)).arrayBuffer();
    const view = new DataView(buf);
    const b = header(view, 0, buf.byteLength);
    if (view.getUint32(0) === 0) b.size = file.size - offset;
    if (offset + b.size > file.size) throw new Error('Truncated MP4 container.');
    if (b.type === 'ftyp' && b.size >= b.bytes + 4) brand = ascii(view, b.bytes, 4);
    if (b.type === 'moov') {
      if (b.size > MAX_MOOV) throw new Error('Metadata exceeds the safe 16 MiB inspection limit.');
      moov = new DataView(await file.slice(offset + b.bytes, offset + b.size).arrayBuffer());
    }
    offset += b.size;
  }
  if (!moov) throw new Error('No MP4 movie metadata found. Select an MP4 or GoPro .360 file.');
  const tracks = children(moov, 0, moov.byteLength).filter(b => b.type === 'trak').map(trak => {
    const handler = descend(moov, trak, ['mdia', 'hdlr']);
    const stsd = descend(moov, trak, ['mdia', 'minf', 'stbl', 'stsd']);
    const type = handler && handler.start + 12 <= handler.end ? ascii(moov, handler.start + 8, 4) : 'unknown';
    const entries = stsd && stsd.start + 8 <= stsd.end ? children(moov, stsd.start + 8, stsd.end) : [];
    const entry = entries[0];
    return {type, codec: entry?.type ?? 'unknown', width: type === 'vide' && entry && entry.start + 28 <= entry.end ? moov.getUint16(entry.start + 24) : null, height: type === 'vide' && entry && entry.start + 28 <= entry.end ? moov.getUint16(entry.start + 26) : null};
  });
  const videoTracks = tracks.filter(t => t.type === 'vide');
  return {brand, tracks, videoTracks, nativeCandidate: /\.360$/i.test(file.name) || videoTracks.length > 1};
}
export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}
