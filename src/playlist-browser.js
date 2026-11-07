import {playlistDate, playlistSize} from './playlist-model.js';
import {createPlaylistPagination} from './playlist-pagination.js';

// A native dialog on desktop, paired with the world-space panel in WebXR.
// Filenames always enter the DOM as text, never HTML. Thumbnails stay local.
export function createPlaylistBrowser({getState, onSelect, onSort, onDirection}) {
  const $ = id => document.getElementById(id), dialog = $('playlist-window');
  let grid = false, lastKey = '', previousFocus, rendered;
  const pagination = createPlaylistPagination();
  const pageSize = state => !grid && state.doubleHeightRows ? 6 : 12;
  function scrollToClip(id) {
    Array.from($('playlist-items').children).find(node => node.dataset.clipId === id)?.scrollIntoView?.({block:'nearest'});
  }
  function retainVisibleAnchor() {
    const bounds = dialog.getBoundingClientRect();
    const visible = Array.from($('playlist-items').children).filter(node => {
      const rect = node.getBoundingClientRect();
      return rect.bottom > bounds.top && rect.top < bounds.bottom;
    });
    // Retain a still-visible anchor on round trips between unequal page sizes.
    // If the user has scrolled past it, use the first actually visible clip.
    if (!visible.some(node => node.dataset.clipId === pagination.anchorId)) pagination.retain(visible[0]?.dataset.clipId);
  }
  function render(opening = false) {
    if (!dialog.open) return;
    const state = getState(), countNow = pageSize(state);
    const selectionChanged = rendered && (rendered.selectedId !== state.selectedId || rendered.sort !== state.sort || rendered.descending !== state.descending);
    const layoutChanged = rendered && (rendered.grid !== grid || rendered.count !== countNow);
    if (!opening && !selectionChanged && layoutChanged) retainVisibleAnchor();
    const {page, pages, start, count} = pagination.sync(state, countNow);
    const scrollId = opening || selectionChanged ? state.selectedId : layoutChanged ? pagination.anchorId : undefined;
    rendered = {selectedId:state.selectedId, sort:state.sort, descending:state.descending, grid, count};
    $('playlist-sort').value = state.sort;
    $('playlist-direction').textContent = state.descending ? 'Descending ↓' : 'Ascending ↑';
    $('playlist-layout').textContent = grid ? 'Show list' : 'Show grid';
    $('playlist-page').textContent = `${state.items.length} videos · Page ${page + 1} / ${pages}`;
    $('playlist-page-back').disabled = page === 0;
    $('playlist-page-next').disabled = page === pages - 1;
    const key = JSON.stringify([state.version, state.selectedId, grid, page, !!state.doubleHeightRows, state.items.map(item => item.id)]);
    if (key === lastKey) { if (scrollId !== undefined) scrollToClip(scrollId); return; }
    lastKey = key;
    const list = $('playlist-items'); list.className = grid ? 'playlist-grid' : `playlist-list${state.doubleHeightRows ? ' playlist-large-rows' : ''}`;
    // Retain keyboard focus while late thumbnails or metadata reorder the list.
    const focused = document.activeElement?.dataset?.clipId, scrollTop = dialog.scrollTop;
    list.replaceChildren(...state.items.slice(start, start + count).map(item => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'playlist-item';
      button.dataset.clipId = item.id; button.setAttribute('aria-current', String(item.id === state.selectedId));
      // Widen the drawing surface as well as its CSS box. A fixed 16:9 canvas
      // would otherwise keep wide native previews small inside the larger box.
      const large = !grid && state.doubleHeightRows;
      const preview = document.createElement('canvas'); preview.width = large ? 640 : 320; preview.height = large ? 280 : 180;
      preview.setAttribute('aria-hidden', 'true'); const context = preview.getContext('2d');
      context.fillStyle = '#172c30'; context.fillRect(0, 0, preview.width, preview.height);
      if (item.thumbnail) {
        const scale = Math.min(preview.width / item.thumbnail.width, preview.height / item.thumbnail.height);
        const w = item.thumbnail.width * scale, h = item.thumbnail.height * scale;
        context.drawImage(item.thumbnail, (preview.width - w) / 2, (preview.height - h) / 2, w, h);
      } else {
        context.fillStyle = '#a5babc'; context.font = `${large ? 24 : 16}px sans-serif`; context.textAlign = 'center';
        context.fillText(item.thumbnailDone ? 'No supported preview' : state.generateThumbnails ? 'Preview pending' : 'Generation off', preview.width / 2, preview.height / 2 + 5);
      }
      const description = document.createElement('span'), title = document.createElement('strong');
      const size = document.createElement('span'), date = document.createElement('span');
      title.textContent = `${item.added}. ${item.name}`;
      size.textContent = playlistSize(item.size);
      date.textContent = playlistDate(item.dateTaken);
      description.append(title, size, date); button.append(preview, description);
      button.addEventListener('click', () => { close(); onSelect(item.id); });
      return button;
    }));
    if (focused) Array.from(list.children).find(node => node.dataset.clipId === focused)?.focus({preventScroll:true});
    // Metadata/thumbnail refreshes must not steal the reader's scroll position.
    dialog.scrollTop = scrollTop;
    if (scrollId !== undefined) scrollToClip(scrollId);
  }
  function close() { dialog.close(); previousFocus?.focus?.(); }
  function open() {
    if (dialog.open) return;
    const state = getState(); pagination.open(state, pageSize(state));
    previousFocus = document.activeElement; dialog.showModal(); render(true);
  }
  $('open-playlist').addEventListener('click', open);
  $('playlist-close').addEventListener('click', close);
  $('playlist-layout').addEventListener('click', () => { grid = !grid; render(); });
  $('playlist-sort').addEventListener('change', event => { onSort(event.target.value); render(); });
  $('playlist-direction').addEventListener('click', () => { onDirection(); render(); });
  $('playlist-page-back').addEventListener('click', () => { const state = getState(); pagination.move(-1, state, pageSize(state)); render(); scrollToClip(pagination.anchorId); });
  $('playlist-page-next').addEventListener('click', () => { const state = getState(); pagination.move(1, state, pageSize(state)); render(); scrollToClip(pagination.anchorId); });
  dialog.addEventListener('click', event => { if (event.target === dialog) {const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close();} });
  return {render, open, close};
}
