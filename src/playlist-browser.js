import {playlistDate, playlistSize} from './playlist-model.js';

// A native dialog on desktop, paired with the world-space panel in WebXR.
// Filenames always enter the DOM as text, never HTML. Thumbnails stay local.
export function createPlaylistBrowser({getState, onSelect, onSort, onDirection}) {
  const $ = id => document.getElementById(id), dialog = $('playlist-window');
  let grid = false, page = 0, lastKey = '', lastEpoch, previousFocus;
  let previousPageSize = 12;
  function render() {
    if (!dialog.open) return;
    const state = getState(), epoch = state.items[0]?.id.split(':')[0];
    if (epoch !== lastEpoch) { page = 0; lastEpoch = epoch; }
    const pageSize = !grid && state.doubleHeightRows ? 6 : 12;
    // Keep the previous page's first item visible when row density changes.
    if (pageSize !== previousPageSize) page = Math.floor(page * previousPageSize / pageSize);
    previousPageSize = pageSize;
    const pages = Math.max(1, Math.ceil(state.items.length / pageSize));
    page = Math.max(0, Math.min(page, pages - 1));
    $('playlist-sort').value = state.sort;
    $('playlist-direction').textContent = state.descending ? 'Descending ↓' : 'Ascending ↑';
    $('playlist-layout').textContent = grid ? 'Show list' : 'Show grid';
    $('playlist-page').textContent = `${state.items.length} videos · Page ${page + 1} / ${pages}`;
    $('playlist-page-back').disabled = page === 0;
    $('playlist-page-next').disabled = page === pages - 1;
    const key = [state.version, state.selectedId, grid, page, !!state.doubleHeightRows].join('|');
    if (key === lastKey) return;
    lastKey = key;
    const list = $('playlist-items'); list.className = grid ? 'playlist-grid' : `playlist-list${state.doubleHeightRows ? ' playlist-large-rows' : ''}`;
    // Retain keyboard focus while late thumbnails or metadata reorder the list.
    const focused = document.activeElement?.dataset?.clipId;
    list.replaceChildren(...state.items.slice(page * pageSize, (page + 1) * pageSize).map(item => {
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
    if (focused) Array.from(list.children).find(node => node.dataset.clipId === focused)?.focus();
  }
  function close() { dialog.close(); previousFocus?.focus?.(); }
  function open() {
    if (dialog.open) return;
    previousFocus = document.activeElement; dialog.showModal(); render();
  }
  $('open-playlist').addEventListener('click', open);
  $('playlist-close').addEventListener('click', close);
  $('playlist-layout').addEventListener('click', () => { grid = !grid; page = 0; render(); });
  $('playlist-sort').addEventListener('change', event => { page = 0; onSort(event.target.value); render(); });
  $('playlist-direction').addEventListener('click', () => { page = 0; onDirection(); render(); });
  $('playlist-page-back').addEventListener('click', () => { page--; render(); });
  $('playlist-page-next').addEventListener('click', () => { page++; render(); });
  dialog.addEventListener('click', event => { if (event.target === dialog) {const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close();} });
  return {render, open, close};
}
