import {installDesktopFullscreenControls} from '../src/desktop-fullscreen-controls.js';
import {resolvePlaylistSeek,readPlaylistSeekDuration} from '../src/playlist-seek.js';
import {createNextClipPreloader,shouldPreloadNext} from '../src/next-clip-preload.js';
import {xrClipCaption} from '../src/xr-clip-caption.js';
import {installKeyboardControls} from '../src/keyboard-controls.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createPlaylistEntries, sortPlaylistEntries, PLAYLIST_SORTS} from '../src/playlist-model.js';
const source = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return {promise, resolve, reject}; };
const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
const files = [{name: 'a.360', size: 100}, {name: 'b.360', size: 200}];
function setup({metadata = async () => ({}), thumbnail = async () => null, storage} = {}) {
  const elements = new Map(), players = [], windows = {}, previews = [];
  let hides = 0, closes = 0;
  function el(id) {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, {textContent: '', hidden: false, value: 0, checked: true, paused: true, handlers: {},
        classList: {add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name)},
        addEventListener(name, fn) { (this.handlers[name] ??= []).push(fn); },
        emit(name) { for (const fn of this.handlers[name] || []) fn({target: this}); },
        canPlayType() { return ''; }, focus() { this.focused = true; }, pause() { this.paused = true; },
        play() { this.paused = false; return Promise.resolve(); }, load() {}, removeAttribute() {}, replaceChildren(...children) { this.children = children; }});
    }
    return elements.get(id);
  }
  const context = vm.createContext({installDesktopFullscreenControls,resolvePlaylistSeek,readPlaylistSeekDuration,createNextClipPreloader,shouldPreloadNext,prepareNextClip:async()=>null,installKeyboardControls,createPlaylistEntries, sortPlaylistEntries, PLAYLIST_SORTS, AbortController,
    createPlaylistBrowser: () => ({render() {}, close() { closes++; }}), readPlaylistMetadata: metadata,
    createPlaylistThumbnail: (file, options) => { previews.push({file, ...options}); return thumbnail(file, options); },
    document: {getElementById: el, createElement: () => ({})}, window: {localStorage: storage, addEventListener: (name, fn) => { windows[name] = fn; }},
    URL: {createObjectURL: () => 'blob:synthetic', revokeObjectURL() {}},
    createRenderer: () => ({setSource() {}, setMaxSources() {}, hideXRControls() { hides++; }}), demoPanorama: () => ({}), formatTime: String,
    inspectFile: async () => ({nativeCandidate: true, tracks: []}),
    createNativePlayer: async (file, options) => {
      const player = {file, options, playing: false, duration: 10, audioState: {available: true, modes: ['stereo'], mode: 'stereo'},
        setMuted() {}, setVolume() {}, play() { this.playing = true; return Promise.resolve(); }, pause() { this.playing = false; }, close() { this.closed = true; }};
      players.push(player); return player;
    }});
  vm.runInContext(source, context);
  return {context, el, players, previews, windows, hides: () => hides, closes: () => closes, state: () => context.playlistState()};
}
test('late metadata cannot mutate replacement queue and preserves selected ID when dates reorder', async () => {
  const first = deferred();
  const h = setup({metadata: file => file === files[0] ? first.promise : Promise.resolve({dateTaken: 10})});
  await h.context.setPlaylist(files); h.context.sortPlaylist('dateTaken');
  await h.context.setPlaylist([files[1]]); await flush();
  const id = h.state().selectedId;
  first.resolve({dateTaken: 100}); await flush();
  assert.equal(h.state().items.length, 1); assert.equal(h.state().selectedId, id);
  assert.equal(h.state().items[0].file, files[1]); assert.equal(h.state().items[0].dateTaken, 10);
});
test('stale thumbnail is discarded after queue replacement and replacement work restarts', async () => {
  const first = deferred(); let calls = 0;
  const h = setup({thumbnail: () => ++calls === 1 ? first.promise : Promise.resolve({newPreview: true})});
  await h.context.setPlaylist(files); await flush(); assert.equal(h.previews.length, 1);
  await h.context.setPlaylist([files[1]]); assert.equal(h.previews[0].signal.aborted, true);
  first.resolve({stalePreview: true}); await flush();
  assert.equal(h.previews.length, 2); assert.equal(h.state().items[0].thumbnail.newPreview, true);
});
test('preview failure is attempted once and aborting for demo does not restart the queue', async () => {
  const h = setup({thumbnail: async () => { throw Error('unsupported'); }});
  await h.context.setPlaylist(files); await flush();
  h.context.schedulePreviews(); await flush(); assert.equal(h.previews.length, 2);
  assert.ok(h.state().items.every(item => item.thumbnailDone && item.thumbnail === null));
  h.el('demo').emit('click'); await flush(); assert.equal(h.state().items.length, 0); assert.equal(h.previews.length, 2);
});
test('pending play suppresses restart of an aborted thumbnail until play settles', async () => {
  const thumbnail = (_file, {signal}) => new Promise(resolve => signal.addEventListener('abort', () => resolve(null), {once: true}));
  const h = setup({thumbnail}); await h.context.setPlaylist(files); await flush(); assert.equal(h.previews.length, 1);
  const pending = deferred(), player = h.players[0];
  player.play = () => pending.promise.then(() => { player.playing = true; });
  const playing = h.context.togglePlayback(); await flush();
  const previewCountWhilePending = h.previews.length;
  pending.resolve(); await playing; await flush(); h.el('demo').emit('click'); await flush();
  assert.equal(previewCountWhilePending, 1, 'Play request must not restart a preview while audio unlock is pending');
});
test('selecting playlist item hides controls and canvas interaction restores them', async () => {
  const h = setup(); await h.context.setPlaylist(files); await flush();
  await h.context.selectPlaylistItem(h.state().items[1].id);
  assert.equal(h.el('viewer').classList.contains('controls-hidden'), true);
  assert.equal(h.el('canvas').focused, true); assert.equal(h.hides(), 1); assert.equal(h.closes(), 1);
  h.el('canvas').emit('pointerdown'); assert.equal(h.el('viewer').classList.contains('controls-hidden'), false);
});
test('pagehide aborts pending thumbnail and prevents late restart', async () => {
  const pending = deferred(), h = setup({thumbnail: () => pending.promise});
  await h.context.setPlaylist(files); await flush(); h.windows.pagehide();
  assert.equal(h.previews[0].signal.aborted, true); pending.resolve({}); await flush();
  assert.equal(h.previews.length, 1); assert.equal(h.state().items.length, 0);
});
test('incremental metadata date sort preserves active clip without reopening it', async () => {
  const one = deferred(), two = deferred();
  const h = setup({metadata: file => file === files[0] ? one.promise : two.promise});
  await h.context.setPlaylist(files); const selected = h.state().selectedId;
  h.context.sortPlaylist('dateTaken', false);
  one.resolve({dateTaken: 100}); await flush(); two.resolve({dateTaken: 50}); await flush();
  assert.equal(h.state().items[0].file, files[1]); assert.equal(h.state().selectedId, selected);
  assert.equal(h.players.length, 1); assert.equal(h.el('playlist-position').textContent, '2 / 2');
});
test('rejected play allows paused thumbnail processing to resume', async () => {
  let calls = 0;
  const h = setup({thumbnail: (_file, {signal}) => ++calls === 1 ? new Promise(resolve => signal.addEventListener('abort', () => resolve(null), {once: true})) : Promise.resolve(null)});
  await h.context.setPlaylist(files); await flush();
  h.players[0].play = async () => { throw Error('gesture required'); };
  await h.context.togglePlayback(); await flush();
  assert.ok(h.state().items.every(item => item.thumbnailDone));
  assert.match(h.el('status').textContent, /gesture required/);
});
test('pending playback from an old clip cannot suppress new previews or clear a newer play guard', async () => {
  const h = setup(); await h.context.setPlaylist(files); await flush();
  const old = deferred(); h.players[0].play = () => old.promise;
  const oldPlay = h.context.togglePlayback(); await h.context.selectClip(1, false);
  assert.equal(vm.runInContext('pendingPlayback', h.context), 0);
  const current = deferred(); h.players[1].play = () => current.promise;
  const newPlay = h.context.togglePlayback();
  old.resolve(); await oldPlay; assert.equal(vm.runInContext('pendingPlayback', h.context), 1);
  current.resolve(); await newPlay; assert.equal(vm.runInContext('pendingPlayback', h.context), 0);
});
test('saved opt-out is respected, missing previews retry on opt-in, and completed ones remain', async()=>{
 const h=setup({storage:{getItem:key=>key.endsWith('.generateThumbnails')?'false':null,setItem(){}},thumbnail:async(_file,{generate})=>generate?{thumbnailSource:'Generated midpoint frame'}:null});
 await h.context.setPlaylist(files);await flush();
 assert.equal(h.el('generate-thumbnails').checked,false);assert.ok(h.previews.every(p=>p.generate===false));assert.ok(h.state().items.every(item=>item.thumbnailDone&&!item.thumbnail));
 h.el('generate-thumbnails').checked=true;h.el('generate-thumbnails').emit('change');await flush();
 assert.equal(h.previews.length,4);assert.ok(h.state().items.every(item=>item.thumbnail&&item.thumbnailSource==='Generated midpoint frame'));
 h.el('generate-thumbnails').checked=false;h.el('generate-thumbnails').emit('change');await flush();assert.equal(h.previews.length,4);assert.ok(h.state().items.every(item=>item.thumbnail));
 await h.context.setPlaylist([files[0]]);await flush();assert.equal(h.previews.at(-1).generate,false);assert.equal(h.state().items[0].thumbnail,null);
});
test('turning generation off cancels the active decoder and discards its late result', async()=>{
 const pending=deferred();const h=setup({thumbnail:(_file,{generate})=>generate?pending.promise:Promise.resolve(null)});
 await h.context.setPlaylist(files);await flush();h.el('generate-thumbnails').checked=true;h.el('generate-thumbnails').emit('change');await flush();
 const active=h.previews.at(-1);assert.equal(active.generate,true);
 h.el('generate-thumbnails').checked=false;h.el('generate-thumbnails').emit('change');assert.equal(active.signal.aborted,true);
 pending.resolve({thumbnailSource:'stale generated preview'});await flush();assert.ok(h.state().items.every(item=>item.thumbnail===null));assert.equal(h.previews.at(-1).generate,false);
});
test('browser-only settings do not add XR setting actions or reset play/view preferences', async()=>{
 const h=setup();await h.context.setPlaylist(files);await flush();h.players[0].playing=true;
 h.el('generate-thumbnails').checked=true;h.el('generate-thumbnails').emit('change');await flush();assert.equal(h.previews.length,2);
 assert.equal(h.players.length,1);assert.equal(h.hides(),0);assert.equal(h.players[0].playing,true);
 h.players[0].playing=false;h.context.schedulePreviews();await flush();assert.equal(h.previews.length,4);
});

const storageKey = name => `gopro-max-vr-player.gallery.${name}`;
function savedStorage(values = {}) {
 const data = new Map(Object.entries(values));
 return {data, getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value)};
}
test('new and existing browsers without an explicit thumbnail choice default on without saving defaults', async()=>{
 for(const storage of [undefined,savedStorage(),savedStorage({[storageKey('doubleHeightRows')]:'true'}),savedStorage({[storageKey('generateThumbnails')]:'invalid'})]){
  const before=storage&&Array.from(storage.data);
  const h=setup({storage,thumbnail:async()=>({thumbnailSource:'Generated midpoint frame'})});
  await h.context.setPlaylist(files);await flush();
  assert.equal(h.el('generate-thumbnails').checked,true);assert.ok(h.previews.every(p=>p.generate===true));assert.ok(h.state().items.every(item=>item.thumbnail));
  if(storage)assert.deepEqual(Array.from(storage.data),before,'startup never turns a default into an explicit user choice');
 }
});
test('only explicit gallery booleans persist across reload, including opt-out and normal row size', async()=>{
 const storage=savedStorage(),h=setup({storage});await h.context.setPlaylist(files);await flush();
 h.el('generate-thumbnails').checked=false;h.el('generate-thumbnails').emit('change');
 h.el('double-height-rows').checked=true;h.el('double-height-rows').emit('change');
 assert.deepEqual(Object.fromEntries(storage.data),{[storageKey('generateThumbnails')]:'false',[storageKey('doubleHeightRows')]:'true'});
 const next=setup({storage});assert.equal(next.el('generate-thumbnails').checked,false);assert.equal(next.el('double-height-rows').checked,true);assert.equal(next.state().doubleHeightRows,true);
 next.el('double-height-rows').checked=false;next.el('double-height-rows').emit('change');
 next.el('generate-thumbnails').checked=true;next.el('generate-thumbnails').emit('change');
 const again=setup({storage});assert.equal(again.el('generate-thumbnails').checked,true);assert.equal(again.state().doubleHeightRows,false);
});
test('blocked local storage reads and failed writes preserve working session preferences',()=>{
 const storage={getItem(){throw Error('SecurityError');},setItem(){throw Error('QuotaExceededError');}};
 const h=setup({storage});assert.equal(h.el('generate-thumbnails').checked,true);assert.equal(h.state().doubleHeightRows,false);
 h.el('generate-thumbnails').checked=false;h.el('generate-thumbnails').emit('change');
 h.el('double-height-rows').checked=true;h.el('double-height-rows').emit('change');
 assert.equal(h.state().generateThumbnails,false);assert.equal(h.state().doubleHeightRows,true);
 const blocked=setup();Object.defineProperty(blocked.context.window,'localStorage',{get(){throw Error('SecurityError');}});
 blocked.el('double-height-rows').checked=true;blocked.el('double-height-rows').emit('change');assert.equal(blocked.state().doubleHeightRows,true);
});
test('row size changes do not restart playback, cancel previews or lose selected clip and sort',async()=>{
 const pending=deferred(),h=setup({thumbnail:()=>pending.promise});await h.context.setPlaylist(files);await flush();
 h.context.sortPlaylist('size',true);const selected=h.state().selectedId,active=h.previews[0],version=h.state().version;
 h.el('double-height-rows').checked=true;h.el('double-height-rows').emit('change');
 assert.equal(h.previews.length,1);assert.equal(active.signal.aborted,false);assert.equal(h.players.length,1);
 assert.equal(h.state().selectedId,selected);assert.equal(h.state().sort,'size');assert.equal(h.state().descending,true);assert.ok(h.state().version>version);
 pending.resolve({thumbnailSource:'Generated midpoint frame'});await flush();assert.ok(h.state().items.every(item=>item.thumbnail));
 h.players[0].playing=true;h.el('double-height-rows').checked=false;h.el('double-height-rows').emit('change');
 assert.equal(h.players[0].playing,true);assert.equal(h.previews.length,2);assert.equal(h.hides(),0);
});
test('rapid generation off/on discards stale work and retains one active generation loop',async()=>{
 const pending=deferred();let calls=0;const h=setup({thumbnail:()=>++calls===1?pending.promise:Promise.resolve({fresh:true})});
 await h.context.setPlaylist(files);await flush();
 h.el('generate-thumbnails').checked=false;h.el('generate-thumbnails').emit('change');
 h.el('generate-thumbnails').checked=true;h.el('generate-thumbnails').emit('change');
 assert.equal(h.previews.length,1);assert.equal(h.previews[0].signal.aborted,true);
 pending.resolve({stale:true});await flush();assert.equal(h.previews.length,3);assert.ok(h.state().items.every(item=>item.thumbnail.fresh));
});


test('VR caption reads the live selection through delayed metadata, queue replacement, demo and pagehide', async()=>{
 const pending=[];
 const h=setup({metadata:file=>{const task=deferred();pending.push({file,...task});return task.promise;}});
 const caption=()=>xrClipCaption(h.state());
 await h.context.setPlaylist(files);assert.equal(caption().name,'a.360');assert.equal(caption().date,'Reading file date…');
 await h.context.selectClip(1,false);assert.equal(caption().name,'b.360');
 pending[0].resolve({dateTaken:Date.UTC(2023,0,1)});await flush();assert.equal(caption().date,'Reading file date…');
 pending[1].resolve({dateTaken:Date.UTC(2024,3,15,12)});await flush();assert.match(caption().date,/2024-04-15 12:00:00/);
 h.context.sortPlaylist('dateTaken',true);assert.equal(caption().name,'b.360');
 await h.context.setPlaylist([{name:'replacement.mp4',size:3}]);assert.equal(caption().name,'replacement.mp4');assert.equal(caption().date,'Reading file date…');
 h.el('demo').emit('click');pending[2].resolve({dateTaken:Date.UTC(2020,0,1)});await flush();assert.equal(caption(),null);
 await h.context.setPlaylist(files);h.windows.pagehide();pending[3].resolve({dateTaken:Date.UTC(2020,0,1)});await flush();assert.equal(caption(),null);
});
