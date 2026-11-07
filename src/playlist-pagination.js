// Both galleries use stable clip IDs, never filenames or addition numbers, to
// retain their place. Keep the anchor across density changes so list/grid/list
// round trips do not walk backwards through differently sized pages.
export function playlistPage(length, count, requested = 0) {
  count = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1;
  const pages = Math.max(1, Math.ceil(length / count));
  const page = Math.max(0, Math.min(pages - 1, Number.isFinite(requested) ? Math.floor(requested) : 0));
  return {page, pages, count, start: page * count};
}

export function createPlaylistPagination() {
  let initialized = false, anchor, selectedId, sort, descending, page = 0;
  function sync(playlist = {}, count, opening = false) {
    const items = playlist.items || [];
    count = playlistPage(items.length, count).count;
    const followSelection = opening || !initialized || selectedId !== playlist.selectedId ||
      sort !== playlist.sort || descending !== !!playlist.descending;
    let index = items.findIndex(item => item.id === anchor);
    if (followSelection || index < 0) {
      const selected = items.findIndex(item => item.id === playlist.selectedId);
      const fallback = followSelection ? 0 : page;
      const target = playlistPage(items.length, count, selected >= 0 ? selected / count : fallback);
      index = target.start;
      anchor = items[index]?.id;
    }
    const result = playlistPage(items.length, count, index / count);
    page = result.page; selectedId = playlist.selectedId; sort = playlist.sort;
    descending = !!playlist.descending; initialized = true;
    return result;
  }
  return {
    sync,
    get anchorId() { return anchor; },
    retain(id) { if (id !== undefined) anchor = id; },
    open: (playlist, count) => sync(playlist, count, true),
    move(offset, playlist, count) {
      const current = sync(playlist, count);
      const result = playlistPage(playlist.items?.length || 0, count, current.page + offset);
      anchor = playlist.items?.[result.start]?.id; page = result.page;
      return result;
    }
  };
}
