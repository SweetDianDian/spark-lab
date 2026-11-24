import { getLearningPathItem, LEARNING_PATH } from '../data/learning-path';
import { catalogueReturnPath } from '../data/theater';

export type ChapterMode = 'learn' | 'lab';
const bookmarkKey = 'spark-lab:last-chapter';

export function catalogueReturn(search: string, id: string) {
  const raw = new URLSearchParams(search).get('returnTo');
  const origin = catalogueReturnPath(raw);
  if (origin === '/' || origin === '/explore') return origin;
  if (origin?.startsWith('/explore?')) {
    const query = new URLSearchParams(origin.slice(9));
    const at = query.get('at');
    if (at && !getLearningPathItem(at)) query.delete('at');
    if (query.size) return '/explore?' + query;
  }
  return '/explore?at=' + encodeURIComponent(id);
}

export function chapterPath(mode: ChapterMode, id: string, search = '', sameChapter = false) {
  const source = new URLSearchParams(search);
  const params = sameChapter ? source : new URLSearchParams();
  if (source.has('returnTo')) {
    params.set('returnTo', catalogueReturn(search, id));
  }
  return '/' + mode + '/' + encodeURIComponent(id) + (params.size ? '?' + params : '');
}

export function practiceAfterComparison(id: string, origin: string) {
  const separator = origin.indexOf('?');
  const path = separator < 0 ? origin : origin.slice(0, separator);
  const search = separator < 0 ? '' : origin.slice(separator + 1);
  if (/^\/(learn|lab)\//.test(path)) return chapterPath('lab', id, search, path.endsWith('/' + id));
  return chapterPath('lab', id, new URLSearchParams({ returnTo: origin }).toString());
}

export function rememberChapter(mode: ChapterMode, id: string) {
  try { localStorage.setItem(bookmarkKey, JSON.stringify({ mode, id })); } catch { /* optional */ }
}

export function lastChapterPath() {
  try {
    const { mode, id } = JSON.parse(localStorage.getItem(bookmarkKey) ?? 'null') ?? {};
    if ((mode === 'learn' || mode === 'lab') && getLearningPathItem(id)) return chapterPath(mode, id);
  } catch { /* Fall back to the first chapter. */ }
  return chapterPath('learn', LEARNING_PATH[0].lessonId);
}
