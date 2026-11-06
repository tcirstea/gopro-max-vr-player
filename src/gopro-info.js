// Static GoPro user-data only. Retain two non-identifying fields; never return
// serial/device identifiers, GPS, owner information, raw records or telemetry.
const MAX_BYTES = 1024 * 1024, MAX_RECORDS = 10000, MAX_DEPTH = 4;
export function readGoProInfo(view, box) {
  const empty = {cameraModel: null, cameraFirmware: null};
  if (!box || box.end - box.start > MAX_BYTES) return empty;
  const result = {...empty};
  let records = 0;
  const ascii = (at, length) => String.fromCharCode(...new Uint8Array(view.buffer, view.byteOffset + at, length));
  function walk(start, end, depth, inDevice = false) {
    if (depth > MAX_DEPTH) throw new Error('GPMF nesting limit');
    let at = start;
    while (at < end) {
      // GoPro reserves zero-filled space after the static records. Accept only
      // an entirely zero tail, never skip arbitrary malformed bytes.
      if (view.getUint8(at) === 0 && new Uint8Array(view.buffer, view.byteOffset + at, end - at).every(byte => byte === 0)) return;
      if (++records > MAX_RECORDS || at + 8 > end) throw new Error('Invalid GPMF header');
      const key = ascii(at, 4), type = view.getUint8(at + 4), size = view.getUint8(at + 5), count = view.getUint16(at + 6);
      const data = at + 8, length = size * count, next = data + Math.ceil(length / 4) * 4;
      if (!size || next > end) throw new Error('Invalid GPMF length');
      if (key === 'DEVC' && type === 0) walk(data, data + length, depth + 1, true);
      else if (inDevice && type === 0x63 && length > 0 && length <= 128 && ['MINF', 'FMWR'].includes(key)) {
        const text = ascii(data, length).replace(/\0+$/, '').trim();
        if (text && /^[\x20-\x7e]+$/.test(text)) result[key === 'MINF' ? 'cameraModel' : 'cameraFirmware'] = text;
      }
      at = next;
    }
  }
  try { walk(box.start, box.end, 0); return result; }
  catch { return empty; }
}
