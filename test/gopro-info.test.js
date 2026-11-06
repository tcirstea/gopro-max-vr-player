import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readGoProInfo} from '../src/gopro-info.js';
const record = (key, type, size, count, raw) => {
  const header = Buffer.alloc(8), data = Buffer.alloc(Math.ceil(raw.length / 4) * 4);
  header.write(key); header[4] = type.charCodeAt(0); header[5] = size; header.writeUInt16BE(count, 6); raw.copy(data);
  return Buffer.concat([header, data]);
};
const text = (key, value) => record(key, 'c', 1, value.length, Buffer.from(value));
const device = (...parts) => { const raw = Buffer.concat(parts); return record('DEVC', '\0', 1, raw.length, raw); };
const parse = raw => readGoProInfo(new DataView(raw.buffer, raw.byteOffset, raw.byteLength), {start: 0, end: raw.length});
test('static GoPro info only exposes verified non-identifying model and firmware fields', () => {
  const raw = device(text('DVNM', 'Global Settings'), text('MINF', 'Synthetic Camera\0\0'), text('FMWR', 'TEST.01\0'), text('SERN', 'private-identifier'), text('GPSU', 'private-time'), text('OWNR', 'private-owner'));
  assert.deepEqual(parse(raw), {cameraModel: 'Synthetic Camera', cameraFirmware: 'TEST.01'});
});
test('unsupported, binary, missing, misplaced and malformed camera tags remain unavailable', () => {
  assert.deepEqual(parse(text('MINF', 'not in device')), {cameraModel: null, cameraFirmware: null});
  assert.equal(parse(device(record('MINF', 'L', 1, 4, Buffer.from('FAKE')))).cameraModel, null);
  assert.equal(parse(device(text('MINF', 'bad\0name'))).cameraModel, null);
  assert.equal(parse(device(text('MINF', 'x'.repeat(129)))).cameraModel, null);
  assert.equal(parse(device(text('MINF', 'Synthetic Camera')).subarray(0, 12)).cameraModel, null);
  assert.deepEqual(readGoProInfo(new DataView(new ArrayBuffer(0)), null), {cameraModel: null, cameraFirmware: null});
});
test('static camera metadata bounds nesting, record lengths and total bytes', () => {
  let nested = text('MINF', 'Synthetic'); for(let i = 0; i < 6; i++) nested = device(nested);
  assert.equal(parse(nested).cameraModel, null);
  assert.equal(parse(Buffer.alloc(1024 * 1024 + 1)).cameraModel, null);
  const invalid = device(text('MINF', 'Synthetic')); invalid[13] = 0;
  assert.equal(parse(invalid).cameraModel, null);
});
test('zero-filled reserved static payload tail is accepted but malformed nonzero tail is rejected', () => {
  const raw=device(text('MINF','Synthetic Camera'),text('FMWR','TEST.01'));
  assert.deepEqual(parse(Buffer.concat([raw,Buffer.alloc(24500)])),{cameraModel:'Synthetic Camera',cameraFirmware:'TEST.01'});
  assert.deepEqual(parse(Buffer.concat([raw,Buffer.from([0,0,0,1])])),{cameraModel:null,cameraFirmware:null});
  assert.equal(parse(Buffer.concat(Array.from({length:10001},()=>text('JUNK','x')))).cameraModel,null);
});
