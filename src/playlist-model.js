export const PLAYLIST_SORTS = ['added', 'name', 'size', 'dateTaken', 'fileCreated'];
const names = new Intl.Collator(undefined, {numeric: true, sensitivity: 'base'});
export function createPlaylistEntries(files, epoch = 0) {
  return Array.from(files, (file, index) => ({id: `${epoch}:${index}`, file, name: file.name,
    added: index + 1, size: file.size, dateTaken: null, fileCreated: null,
    thumbnail: null, thumbnailDone: false, metadataDone: false}));
}
export function sortPlaylistEntries(entries, key = 'added', descending = false) {
  if (!PLAYLIST_SORTS.includes(key)) return entries.slice();
  return entries.slice().sort((a, b) => {
    const av = a[key], bv = b[key];
    const missing = v => v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v));
    // Unknown dates remain last in either direction; ties keep original added order.
    if (missing(av) || missing(bv)) return missing(av) === missing(bv) ? a.added - b.added : missing(av) ? 1 : -1;
    const comparison = key === 'name' ? names.compare(av, bv) : av - bv;
    return (descending ? -comparison : comparison) || a.added - b.added;
  });
}
export function playlistDate(value) {
  // Container fields are often camera-local despite the format's UTC convention.
  // Preserve their written clock values instead of silently applying browser timezone.
  return Number.isFinite(value) ? new Date(value).toISOString().slice(0, 19).replace('T', ' ') + ' (timezone unverified)' : 'Unavailable';
}
export function playlistSize(value) {
  return Number.isFinite(value) ? `${(value / 1024 / 1024).toFixed(1)} MiB` : 'Unknown size';
}
