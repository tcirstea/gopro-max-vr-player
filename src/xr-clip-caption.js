// Text-only, local metadata for the current clip. Reuse the playlist's bounded
// asynchronous inspection; never read another file or infer dates from filenames.
import {playlistDate} from './playlist-model.js';
export const CAPTION_WIDTH = 1024, CAPTION_HEIGHT = 96;
export const CAPTION_WORLD_HEIGHT = 1.2 * CAPTION_HEIGHT / CAPTION_WIDTH;
export const CAPTION_GAP = .012;

export function xrClipCaption(playlist) {
  if (playlist?.selectedId === undefined || playlist.selectedId === null) return null;
  const item = playlist.items?.find(item => item.id === playlist.selectedId);
  if (!item) return null; // Demo, cleared queue, or removed selection.
  // File.name is normally a basename. Be defensive about synthetic/path-like
  // names and control characters; no local directory belongs on this label.
  const name = String(item.name || 'Untitled').split(/[\\/]/).at(-1)
    .replace(/\s+/g, ' ').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').trim() || 'Untitled';
  const validDate = Number.isFinite(item.dateTaken) && Number.isFinite(new Date(item.dateTaken).getTime());
  const date = validDate ? `File date: ${playlistDate(item.dateTaken)} · timezone unverified`
    : item.metadataDone === false ? 'Reading file date…' : 'Date unavailable';
  return {id: item.id, name: name.length > 1024 ? Array.from(name).slice(0, 1024).join('') + '…' : name, date};
}

export function fitCaptionText(ctx, text, width) {
  if (ctx.measureText(text).width <= width) return text;
  const characters = Array.from(text);
  let low = 0, high = characters.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (ctx.measureText(characters.slice(0, middle).join('') + '…').width <= width) low = middle;
    else high = middle - 1;
  }
  return characters.slice(0, low).join('') + '…';
}

export function paintClipCaption(ctx, caption) {
  ctx.clearRect(0, 0, CAPTION_WIDTH, CAPTION_HEIGHT);
  if (!caption) return;
  ctx.save();
  // A transparent strip with only outlined glyphs, never a larger panel surface.
  ctx.beginPath();ctx.rect(32, 0, CAPTION_WIDTH - 64, CAPTION_HEIGHT);ctx.clip();
  ctx.textAlign = 'left';ctx.textBaseline = 'alphabetic';
  ctx.strokeStyle = 'rgba(0, 0, 0, .9)';ctx.lineWidth = 5;ctx.lineJoin = 'round';
  const line = (text, y, font, color) => {
    ctx.font = font;ctx.fillStyle = color;
    const label = fitCaptionText(ctx, text, CAPTION_WIDTH - 80);
    ctx.strokeText(label, 40, y);ctx.fillText(label, 40, y);
  };
  line(caption.name, 38, 'bold 32px sans-serif', '#ffffff');
  line(caption.date, 76, '24px sans-serif', '#e0edf2');
  ctx.restore();
}

export function clipCaptionCenter(panel, panelHeight) {
  return panel.center.map((value, i) => value + panel.up[i] * (panelHeight / 2 + CAPTION_GAP + CAPTION_WORLD_HEIGHT / 2));
}
