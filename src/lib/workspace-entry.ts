import type { Language } from '../types';
import { getStoryStarter } from './tool-story';

export function parseStoryPeople(value: string | null): number {
  if (value === null) return 17;
  if (!/^\d{1,2}$/.test(value)) return 17;
  const people = Number(value);
  return people >= 1 && people <= 99 ? people : 17;
}

/** A story can replace an untouched template, but never a custom draft/replay. */
export function chooseWorkspaceCode(args: { language: Language; draft: unknown; defaultCode: string; storyPeople: number | null; replay: boolean }): string {
  const { language, draft, defaultCode, storyPeople, replay } = args;
  const existing = typeof draft === 'string' ? draft : defaultCode;
  if (storyPeople === null || replay) return existing;
  return !existing.trim() || existing === defaultCode ? getStoryStarter(language, storyPeople) : existing;
}
