import type { Language, SavedRun } from '../types';
const PREFIX = 'spark-lab:v1:';
export function readStorage<T>(key: string, fallback: T): T {
  try { const value = localStorage.getItem(PREFIX + key); return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
}
export function writeStorage(key: string, value: unknown): boolean {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); return true; } catch { return false; }
}
export const getCompleted = () => readStorage<string[]>('completed', []);
export function completeLesson(id: string) { const completed = getCompleted(); if (!completed.includes(id)) writeStorage('completed', [...completed, id]); }
export const getRuns = () => readStorage<SavedRun[]>('runs', []);
export function saveRun(run: SavedRun) { return writeStorage('runs', [run, ...getRuns().filter(item => item.id !== run.id)].slice(0, 15)); }
export function deleteRun(id: string) { writeStorage('runs', getRuns().filter(item => item.id !== id)); }
export const getLanguage = (): Language => {
  const stored = readStorage<unknown>('language', 'typescript');
  return stored === 'python' || stored === 'javascript' ? stored : 'typescript';
};
export const setLanguage = (language: Language) => writeStorage('language', language);
export const getDraft = (id: string, language: Language, fallback: string) => readStorage<string>(`draft:${id}:${language}`, fallback);
export const setDraft = (id: string, language: Language, code: string) => writeStorage(`draft:${id}:${language}`, code);
export const getNote = (id: string) => readStorage<string>(`note:${id}`, '');
export const setNote = (id: string, text: string) => writeStorage(`note:${id}`, text);
