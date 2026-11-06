import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readPlaylistMetadata, createPlaylistThumbnail} from '../src/playlist-media.js';
const box = (type, ...parts) => { const p = Buffer.concat(parts), h = Buffer.alloc(8); h.writeUInt32BE(p.length + 8); h.write(type, 4); return Buffer.concat([h, p]); };
const words = (...values) => { const b = Buffer.alloc(values.length * 4); values.forEach((v, i) => b.writeUInt32BE(v, i * 4)); return b; };
const date = Date.UTC(2024, 3, 15, 12);
function dateBox(type, value = date, version = 0) {
  const b = Buffer.alloc(version ? 32 : 20); b[0] = version;
  const seconds = value === null ? 0 : value / 1000 + 2082844800;
  if (version) b.writeBigUInt64BE(BigInt(seconds), 4); else b.writeUInt32BE(seconds, 4);
  return box(type, b);
}
const file = (...parts) => new File(parts, 'synthetic.mp4', {lastModified: Date.UTC(2025, 0, 1)});
test('embedded movie date is explicit; lastModified never becomes creation date', async () => {
  assert.deepEqual(await readPlaylistMetadata(file(box('moov', dateBox('mvhd')))), {dateTaken: date, dateTakenSource: 'Embedded movie creation time (timezone unverified)', fileCreated: null, cameraModel: null, cameraFirmware: null, duration: null, videoTracks: [], nativeCandidate: false});
  assert.deepEqual(await readPlaylistMetadata(file(box('moov'))), {dateTaken: null, dateTakenSource: null, fileCreated: null, cameraModel: null, cameraFirmware: null, duration: null, videoTracks: [], nativeCandidate: false});
});
test('64-bit media date is a fallback for missing or zero movie date', async () => {
  const input = file(box('moov', dateBox('mvhd', null), box('trak', box('mdia', dateBox('mdhd', date, 1)))));
  const result = await readPlaylistMetadata(input);
  assert.equal(result.dateTaken, date); assert.equal(result.dateTakenSource, 'Embedded media creation time (timezone unverified)'); assert.equal(result.fileCreated, null);
});
test('invalid, implausible and truncated dates stay unknown', async () => {
  for (const contents of [Buffer.from('not a movie'), box('moov', dateBox('mvhd', Date.UTC(2050, 0, 1), 1)), box('moov', box('mvhd', Buffer.alloc(3)))]) {
    assert.equal((await readPlaylistMetadata(file(contents))).dateTaken, null);
  }
});
test('metadata skips large payloads with bounded reads', async () => {
  const data = Buffer.concat([box('mdat', Buffer.alloc(1024 * 1024)), box('moov', dateBox('mvhd'))]);
  const reads = [];
  const input = {size: data.length, slice(a, b) { reads.push(b - a); return new Blob([data.subarray(a, b)]); }};
  assert.equal((await readPlaylistMetadata(input)).dateTaken, date);
  assert.ok(reads.reduce((a, b) => a + b, 0) < 200);
});
test('thumbnail gracefully handles unavailable DOM and pre-abort', async () => {
  assert.equal(await createPlaylistThumbnail(file()), null);
  const controller = new AbortController(); controller.abort();
  assert.equal(await createPlaylistThumbnail(file(), {signal: controller.signal}), null);
});
function nativeFile() {
  const hvcc = Buffer.alloc(23); hvcc[0] = 1; hvcc[1] = 1; hvcc[2] = 0x60; hvcc[12] = 153;
  const h = Buffer.alloc(12); h.write('vide', 8);
  const entry = Buffer.alloc(78); entry.writeUInt16BE(4096, 24); entry.writeUInt16BE(1344, 26);
  const track = box('trak', box('mdia', box('hdlr', h), box('mdhd', words(0, 0, 0, 1000, 200)), box('minf', box('stbl',
    box('stsd', words(0, 1), box('hvc1', entry, box('hvcC', hvcc))), box('stsz', words(0, 1, 5)), box('stts', words(0, 1, 5, 40)),
    box('stss', words(0, 3, 1, 3, 5)), box('stsc', words(0, 1, 1, 5, 1)), box('stco', words(0, 1, 8))))));
  return new File([box('mdat', Buffer.alloc(5)), box('moov', track, track)], 'synthetic.360');
}
async function mockedGlobals(values, run) {
  const saved = Object.fromEntries(Object.keys(values).map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  Object.assign(globalThis, values);
  try { await run(); } finally { for (const [key, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } }
}
test('native thumbnail decodes only midpoint keyframe on one track and closes resources', async () => {
  let closed = 0, framesClosed = 0, allocations = 0, timestamp;
  class Decoder {
    static async isConfigSupported() { return {supported: true}; }
    constructor(options) { this.options = options; this.state = 'unconfigured'; allocations++; }
    configure() { this.state = 'configured'; }
    decode(chunk) { timestamp = chunk.timestamp; this.options.output({displayWidth: 4096, displayHeight: 1344, close() { framesClosed++; }}); }
    async flush() {}
    close() { this.state = 'closed'; closed++; }
  }
  await mockedGlobals({VideoDecoder: Decoder, EncodedVideoChunk: class { constructor(x) { Object.assign(this, x); } }, document: {createElement() { return {getContext() { return {drawImage() {}}; }}; }}}, async () => {
    const image = await createPlaylistThumbnail(nativeFile(), {generate: true});
    assert.equal(image.width, 320); assert.equal(image.height, 105); assert.equal(timestamp, 80000);
    assert.equal(allocations, 1); assert.equal(closed, 1); assert.equal(framesClosed, 1);
  });
});
test('native codec unsupported allocates no decoder', async () => {
  await mockedGlobals({document: {}, EncodedVideoChunk: class {}, VideoDecoder: class { static async isConfigSupported() { return {supported: false}; } constructor() { assert.fail('Unsupported decoder allocated'); } }}, async () => {
    assert.equal(await createPlaylistThumbnail(nativeFile(), {generate: true}), null);
  });
});
test('abort releases stalled native decoder and resolves promptly', async () => {
  let closed = 0; const controller = new AbortController();
  class Decoder {
    static async isConfigSupported() { return {supported: true}; }
    constructor() { this.state = 'unconfigured'; }
    configure() { this.state = 'configured'; }
    decode() { queueMicrotask(() => controller.abort()); }
    flush() { return new Promise(() => {}); }
    close() { this.state = 'closed'; closed++; }
  }
  await mockedGlobals({document: {}, EncodedVideoChunk: class {}, VideoDecoder: Decoder}, async () => {
    assert.equal(await createPlaylistThumbnail(nativeFile(), {generate: true, signal: controller.signal}), null);
    await new Promise(resolve => setImmediate(resolve)); assert.equal(closed, 1);
  });
});
test('browser thumbnail seeks midpoint and releases its URL/video', async () => {
  const video = {duration: 20, readyState: 2, videoWidth: 1920, videoHeight: 1080, pause() { this.paused = true; }, removeAttribute() { this.src = ''; },
    load() { if (this.src) queueMicrotask(() => { this.onloadedmetadata?.(); this.onseeked?.(); }); }};
  let revoked = 0;
  await mockedGlobals({document: {createElement(type) { return type === 'video' ? video : {getContext() { return {drawImage() {}}; }}; }}, URL: {createObjectURL() { return 'blob:synthetic'; }, revokeObjectURL() { revoked++; }}}, async () => {
    const image = await createPlaylistThumbnail(file(), {generate: true});
    assert.equal(image.width, 320); assert.equal(image.height, 180); assert.equal(video.currentTime, 10);
    assert.equal(video.paused, true); assert.equal(video.src, ''); assert.equal(revoked, 1); assert.equal(video.onseeked, null);
  });
});
test('midpoint decoding is opt-in and never allocates media resources by default', async () => {
  await mockedGlobals({document: {createElement() { assert.fail('Generation is disabled'); }}, VideoDecoder: class { constructor() { assert.fail('Generation is disabled'); } }}, async () => {
    assert.equal(await createPlaylistThumbnail(file()), null);
    assert.equal(await createPlaylistThumbnail(nativeFile(), {generate: false}), null);
  });
});
test('gallery reads only bounded static GoPro info and video track facts without sample decoding', async () => {
  const klv = (key, type, raw) => { const header = Buffer.alloc(8), padding = Buffer.alloc(Math.ceil(raw.length / 4) * 4); header.write(key); header[4] = type.charCodeAt(0); header[5] = 1; header.writeUInt16BE(raw.length, 6); raw.copy(padding); return Buffer.concat([header, padding]); };
  const camera = klv('DEVC', '\0', Buffer.concat([klv('MINF', 'c', Buffer.from('Synthetic Camera\0')), klv('FMWR', 'c', Buffer.from('TEST.01\0')), klv('SERN', 'c', Buffer.from('private-identifier'))]));
  const input = nativeFile(), raw = Buffer.from(await input.arrayBuffer());
  // Rebuild the moov to add a synthetic user-data atom, never private sample bytes.
  const dataSize = raw.readUInt32BE(0), moov = raw.subarray(dataSize + 8);
  const info = await readPlaylistMetadata(new File([raw.subarray(0, dataSize), box('moov', moov, box('udta', box('GPMF', camera)))], 'renamed.mp4'));
  assert.equal(info.cameraModel, 'Synthetic Camera'); assert.equal(info.cameraFirmware, 'TEST.01'); assert.equal(info.nativeCandidate, true); assert.equal(info.duration, .2);
  assert.deepEqual(info.videoTracks, [{codec:'hvc1', width:4096, height:1344}, {codec:'hvc1', width:4096, height:1344}]);
  assert.doesNotMatch(JSON.stringify(info), /private|SERN/);
});
test('native thumbnail dispatch uses verified track metadata for renamed MP4 clips', async () => {
  let decoders=0,closed=0;
  class Decoder {
    static async isConfigSupported(){return {supported:true};}
    constructor(options){this.options=options;this.state='unconfigured';decoders++;}
    configure(){this.state='configured';}
    decode(){this.options.output({displayWidth:4096,displayHeight:1344,close(){}});}
    async flush(){}
    close(){this.state='closed';closed++;}
  }
  await mockedGlobals({VideoDecoder:Decoder,EncodedVideoChunk:class {},document:{createElement(type){assert.equal(type,'canvas');return {getContext(){return {drawImage(){}};}};}}},async()=>{
    const file=new File([nativeFile()],'renamed.mp4'),metadata=await readPlaylistMetadata(file);
    const image=await createPlaylistThumbnail(file,{generate:true,metadata});
    assert.equal(image.width,320);assert.match(image.thumbnailSource,/native keyframe/);assert.equal(decoders,1);assert.equal(closed,1);
  });
});
test('firmware-only metadata is retained and malformed optional user data preserves normal fields', async () => {
  const record=(key,type,data)=>{const h=Buffer.alloc(8),p=Buffer.alloc(Math.ceil(data.length/4)*4);h.write(key);h[4]=type;h[5]=1;h.writeUInt16BE(data.length,6);data.copy(p);return Buffer.concat([h,p]);};
  const firmware=record('DEVC',0,record('FMWR',0x63,Buffer.from('TEST.01')));
  const model=record('DEVC',0,record('MINF',0x63,Buffer.from('Synthetic Camera')));
  const info=await readPlaylistMetadata(file(box('moov',dateBox('mvhd'),box('udta',box('GPMF',firmware)),box('udta',box('GPMF',model)),box('udta',Buffer.from('invalid')))));
  assert.equal(info.cameraFirmware,'TEST.01');assert.equal(info.cameraModel,'Synthetic Camera');assert.equal(info.dateTaken,date);
  const firmwareOnly=await readPlaylistMetadata(file(box('moov',box('udta',box('GPMF',firmware)))));
  assert.equal(firmwareOnly.cameraModel,null);assert.equal(firmwareOnly.cameraFirmware,'TEST.01');
});
