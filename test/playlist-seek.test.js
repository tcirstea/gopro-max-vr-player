import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolvePlaylistSeek, readPlaylistSeekDuration} from '../src/playlist-seek.js';
const queue = [10, 20, 30].map((duration, id) => ({id, file: {}, duration}));
const resolve = (index, time, items = queue) => resolvePlaylistSeek(items, index, time, {getDuration: item => Promise.resolve(item.duration)});
test('seeks locally and carries forward/backward overshoot through multiple clips', async () => {
  assert.deepEqual(await resolve(1, 7), {index: 1, time: 7, duration: 20});
  assert.deepEqual(await resolve(0, 45), {index: 2, time: 15, duration: 30});
  assert.deepEqual(await resolve(2, -25), {index: 0, time: 5, duration: 10});
  assert.deepEqual(await resolve(2, -20), {index: 1, time: 0, duration: 20});
});
test('exact endpoints advance and global edges clamp without wrapping', async () => {
  assert.deepEqual(await resolve(0, 10), {index: 1, time: 0, duration: 20});
  assert.deepEqual(await resolve(0, 30), {index: 2, time: 0, duration: 30});
  assert.deepEqual(await resolve(0, 600), {index: 2, time: 30, duration: 30});
  assert.deepEqual(await resolve(2, -600), {index: 0, time: 0, duration: 10});
  assert.deepEqual(await resolve(0, -1, queue.slice(0, 1)), {index: 0, time: 0, duration: 10});
});
test('uses actual supplied order and stable objects, reading only traversed clips', async () => {
  const items = [queue[2], queue[0], queue[1]], seen = [];
  const result = await resolvePlaylistSeek(items, 0, 35, {getDuration(item) { seen.push(item); return item.duration; }});
  assert.deepEqual(result, {index: 1, time: 5, duration: 10});
  assert.deepEqual(seen, items.slice(0, 2));
});
test('zero-length entries are finite skips in both directions', async () => {
  const items = [10, 0, 0, 20, 0].map(duration => ({duration}));
  assert.deepEqual(await resolve(0, 10, items), {index: 3, time: 0, duration: 20});
  assert.deepEqual(await resolve(3, -5, items), {index: 0, time: 5, duration: 10});
  assert.deepEqual(await resolve(3, 21, items), {index: 4, time: 0, duration: 0});
  assert.deepEqual(await resolve(0, 1, [{duration: 0}, {duration: 0}]), {index: 1, time: 0, duration: 0});
});
test('unknown, nonnumeric, nonfinite and negative durations reject rather than skip', async () => {
  for (const duration of [undefined, null, NaN, Infinity, -1, '5']) {
    await assert.rejects(resolve(0, 100, [{duration}]), /duration/);
  }
  await assert.rejects(resolvePlaylistSeek(queue, 0, 50, {getDuration: item => item.id ? null : 10}), /duration/);
});
test('invalid indices, empty queues and nonfinite seek inputs reject', async () => {
  for (const index of [-1, 3, 0.5]) await assert.rejects(resolve(index, 0), RangeError);
  await assert.rejects(resolve(0, 0, []), RangeError);
  for (const time of [NaN, Infinity, -Infinity]) await assert.rejects(resolve(0, time), RangeError);
});
test('abort is checked before duration reads and after delayed completion or rejection', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(resolvePlaylistSeek(queue, 0, 20, {signal: controller.signal, getDuration() { assert.fail('must not read'); }}), {name: 'AbortError'});
  for (const reject of [false, true]) {
    const c = new AbortController(); let finish, reads = 0;
    const pending = resolvePlaylistSeek(queue, 0, 20, {signal: c.signal, getDuration() { reads++; return new Promise((yes, no) => { finish = reject ? no : yes; }); }});
    c.abort(); finish(reject ? new Error('late failure') : 10);
    await assert.rejects(pending, {name: 'AbortError'}); assert.equal(reads, 1);
  }
});
const box = (type, ...parts) => { const p = Buffer.concat(parts), h = Buffer.alloc(8); h.writeUInt32BE(p.length + 8); h.write(type, 4); return Buffer.concat([h, p]); };
const words = (...values) => { const b = Buffer.alloc(values.length * 4); values.forEach((v, i) => b.writeUInt32BE(v, i * 4)); return b; };
function nativeFile() {
  const hvcc = Buffer.alloc(23); hvcc[0] = 1; hvcc[1] = 1; hvcc[12] = 153;
  const handler = Buffer.alloc(12); handler.write('vide', 8);
  const entry = Buffer.alloc(78); entry.writeUInt16BE(4096, 24); entry.writeUInt16BE(1344, 26);
  const track = count => box('trak', box('mdia', box('hdlr', handler), box('mdhd', words(0, 0, 0, 1000, 9999)), box('minf', box('stbl',
    box('stsd', words(0, 1), box('hvc1', entry, box('hvcC', hvcc))), box('stsz', words(0, 1, count)), box('stts', words(0, 1, count, 40)),
    box('stsc', words(0, 1, 1, count, 1)), box('stco', words(0, 1, 64))))));
  return new File([box('mdat', Buffer.alloc(1024 * 1024)), box('moov', box('mvhd', words(0, 0, 0, 1000, 99999)), track(5), track(3))], 'renamed.mp4');
}
test('native duration follows common sample-table playback endpoint, bounded metadata only', async t => {
  const original = nativeFile(), reads = [];
  setGlobal(t, 'VideoDecoder', class { constructor() { assert.fail('no decoder'); } });
  const file = {name: original.name, size: original.size, slice(a, b) { reads.push([a, b]); return original.slice(a, b); }};
  assert.equal(await readPlaylistSeekDuration(file), 0.12);
  assert.ok(reads.every(([a, b]) => a >= 1024 * 1024 + 8 || (a === 0 && b === 32)));
  assert.ok(reads.reduce((sum, [a, b]) => sum + b - a, 0) < 5000);
});
function setGlobal(t, key, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.defineProperty(globalThis, key, {value, configurable: true, writable: true});
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; });
}
function browserHarness(t) {
  const video = new EventTarget(); let loads = 0, revoked = 0, plays = 0;
  Object.assign(video, {duration: 12.5, removeAttribute(name) { delete this[name]; }, load() { loads++; }, play() { plays++; }});
  setGlobal(t, 'document', {createElement(name) { assert.equal(name, 'video'); return video; }});
  t.mock.method(URL, 'createObjectURL', () => 'blob:test-duration');
  t.mock.method(URL, 'revokeObjectURL', url => { assert.equal(url, 'blob:test-duration'); revoked++; });
  return {video, stats: () => ({loads, revoked, plays})};
}
const browserFile = () => new File([box('moov')], 'export.mp4');
const settle = () => new Promise(resolve => setImmediate(resolve));
test('browser uses detached metadata only and releases source on success', async t => {
  const h = browserHarness(t), pending = readPlaylistSeekDuration(browserFile());
  await settle(); assert.equal(h.video.preload, 'metadata');
  h.video.dispatchEvent(new Event('loadedmetadata'));
  assert.equal(await pending, 12.5); assert.equal(h.video.src, undefined);
  assert.deepEqual(h.stats(), {loads: 2, revoked: 1, plays: 0});
});
test('browser rejects invalid metadata and media errors and cleans up', async t => {
  const h = browserHarness(t);
  for (const kind of ['loadedmetadata', 'error']) {
    const pending = readPlaylistSeekDuration(browserFile()); await settle();
    h.video.duration = Infinity; h.video.dispatchEvent(new Event(kind));
    await assert.rejects(pending, /duration/);
  }
  assert.deepEqual(h.stats(), {loads: 4, revoked: 2, plays: 0});
});
test('browser timeout and abort clear timers, listeners, Blob URL and source', async t => {
  const h = browserHarness(t); t.mock.timers.enable({apis: ['setTimeout']});
  let pending = readPlaylistSeekDuration(browserFile()); await settle();
  t.mock.timers.tick(10000); await assert.rejects(pending, /Timed out/);
  const c = new AbortController(); pending = readPlaylistSeekDuration(browserFile(), {signal: c.signal}); await settle();
  c.abort(); await assert.rejects(pending, {name: 'AbortError'});
  h.video.dispatchEvent(new Event('loadedmetadata')); t.mock.timers.tick(10000);
  assert.deepEqual(h.stats(), {loads: 4, revoked: 2, plays: 0});
});
test('metadata reader refuses pre-abort and discards delayed native inspection', async () => {
  const c = new AbortController(); c.abort();
  await assert.rejects(readPlaylistSeekDuration(null, {signal: c.signal}), {name: 'AbortError'});
  const input = nativeFile(), late = new AbortController(); let release;
  const file = {name: input.name, size: input.size, slice(a, b) { return {async arrayBuffer() { if (!release) await new Promise(r => { release = r; }); return input.slice(a, b).arrayBuffer(); }}; }};
  const pending = readPlaylistSeekDuration(file, {signal: late.signal}); late.abort(); release();
  await assert.rejects(pending, {name: 'AbortError'});
});
