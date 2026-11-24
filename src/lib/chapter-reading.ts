import { getChapterFilm } from '../data/chapter-films';

const prefix = 'spark-lab:chapter-film:';
const changeEvent = 'spark-chapter-reading';

function readFrames(id: string) {
  const film = getChapterFilm(id);
  const frameIds = film?.frames.map(frame => frame.id) ?? [];
  const key = prefix + id + ':v' + (film?.version ?? 0);
  let seen: string[] = [];
  let last = '';
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (Array.isArray(saved?.seen)) seen = frameIds.filter(frameId => saved.seen.includes(frameId));
    if (seen.includes(saved?.last)) last = saved.last;
  } catch { /* Storage is optional for viewing a film. */ }
  return { key, frameIds, seen, last };
}

export function getChapterReading(id: string) {
  const { frameIds, seen, last } = readFrames(id);
  return { seen: seen.map(frameId => frameIds.indexOf(frameId)), total: frameIds.length,
    last: Math.max(0, frameIds.indexOf(last)), completed: frameIds.length > 0 && seen.length === frameIds.length };
}

export function recordChapterFrame(id: string, index: number) {
  const { key, frameIds, seen, last } = readFrames(id);
  const frame = frameIds[index];
  if (!Number.isInteger(index) || !frame || last === frame) return;
  try {
    localStorage.setItem(key, JSON.stringify({ seen: seen.includes(frame) ? seen : [...seen, frame], last: frame }));
    window.dispatchEvent(new Event(changeEvent));
  } catch { /* Private browsing can disable persistence. */ }
}

export function subscribeChapterReading(callback: () => void) {
  const onStorage = (event: StorageEvent) => { if (!event.key || event.key.startsWith(prefix)) callback(); };
  window.addEventListener(changeEvent, callback);
  window.addEventListener('storage', onStorage);
  return () => { window.removeEventListener(changeEvent, callback); window.removeEventListener('storage', onStorage); };
}
