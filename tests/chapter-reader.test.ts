import test from 'node:test';
import assert from 'node:assert/strict';
import { getChapterFilm } from '../src/data/chapter-films';
import { getChapterReading, recordChapterFrame, subscribeChapterReading } from '../src/lib/chapter-reading';
import { catalogueReturn, chapterPath, lastChapterPath, practiceAfterComparison, rememberChapter } from '../src/lib/chapter-navigation';
import { theaterReturnPath } from '../src/data/theater';

function withStorage(fn: (store: Map<string, string>) => void) {
  const store = new Map<string, string>();
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value),
  } });
  try { fn(store); } finally {
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow); else Reflect.deleteProperty(globalThis, 'window');
    if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage); else Reflect.deleteProperty(globalThis, 'localStorage');
  }
}

test('film progress restores only visited frame IDs and keeps chapters independent', () => withStorage(store => {
  const film = getChapterFilm('rag')!;
  const last = film.frames.length - 1;
  let notifications = 0;
  const unsubscribe = subscribeChapterReading(() => notifications++);
  recordChapterFrame('rag', 0);
  recordChapterFrame('rag', last);
  recordChapterFrame('rag', last + 1);
  recordChapterFrame('rag', last);
  assert.equal(notifications, 2);
  assert.deepEqual(getChapterReading('rag'), { seen: [0,last], last, total: last+1, completed: false });
  assert.deepEqual(getChapterReading('mcp').seen, []);
  recordChapterFrame('rag', 0);
  assert.equal(getChapterReading('rag').last, 0);
  for (let i = 1; i < last; i++) recordChapterFrame('rag', i);
  assert.ok(getChapterReading('rag').completed);
  const saved = JSON.parse([...store.values()][0]);
  assert.ok(saved.seen.includes(film.frames[last].id));
  unsubscribe();
  store.set([...store.keys()][0], '{');
  assert.equal(getChapterReading('rag').seen.length, 0);
  assert.equal(getChapterReading('unknown').completed, false);
}));

test('switching modes retains the story or replay, changing chapters only carries the directory origin', () => {
  const from = '?entry=story&people=19&returnTo=%2Fexplore%3Fat%3Dtools';
  const learn = chapterPath('learn','tools',from,true);
  assert.equal(theaterReturnPath(learn), learn);
  assert.equal(practiceAfterComparison('tools', learn), '/lab/tools' + from);
  assert.equal(practiceAfterComparison('context', learn), '/lab/context?returnTo=%2Fexplore%3Fat%3Dtools');
  assert.equal(chapterPath('lab','context',from), '/lab/context?returnTo=%2Fexplore%3Fat%3Dtools');
  assert.equal(chapterPath('lab','tools','?replay=run1',true), '/lab/tools?replay=run1');
  assert.equal(theaterReturnPath('/learn/first-call?frame=hide-output'), '/learn/first-call?frame=hide-output');
  assert.equal(chapterPath('lab','context','?frame=display'), '/lab/context');
  assert.equal(chapterPath('lab','context','?replay=run1&unknown=value'), '/lab/context');
  assert.equal(catalogueReturn(from,'tools'), '/explore?at=tools');
  assert.equal(catalogueReturn('?returnTo=%2F%2Felsewhere.example','tokens'), '/explore?at=tokens');
});

test('continue opens the previous chapter and mode without rerunning a saved experiment', () => withStorage(() => {
  assert.equal(lastChapterPath(), '/learn/first-call');
  rememberChapter('lab','rag');
  assert.equal(lastChapterPath(), '/lab/rag');
}));
