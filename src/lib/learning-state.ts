import { getLearningPathItem, getPrincipleDefinition, LEARNING_PATH } from '../data/learning-path';
import type { Language, RunMode, RunResult, SavedRun } from '../types';
import { validateLessonRun } from './progress';

const KEY = 'spark-lab:v1:learning-state';
const LEGACY_COMPLETED = 'spark-lab:v1:completed';
const LEGACY_RUNS = 'spark-lab:v1:runs';
const CHANGE_EVENT = 'spark-learning-state-changed';

export type LearningStatus = 'not-started' | 'studying' | 'ran' | 'passed' | 'unavailable';
export type RunSummary = {
  id: string;
  status: RunResult['status'];
  passed: boolean;
  at: number;
  mode?: RunMode;
  language?: Language;
  source: 'recorded-run' | 'saved-run';
};
export type PrincipleProgress = {
  sceneId: string;
  title: string;
  version: number;
  available: boolean;
  seenFrameIds: string[];
  remainingFrameIds: string[];
  firstUnseenFrameId: string | null;
  viewedCount: number;
  totalCount: number;
  completed: boolean;
  lastFrameId: string | null;
};
export type LessonLearningState = {
  lessonId: string;
  title: string;
  objective: string;
  status: LearningStatus;
  principle: PrincipleProgress | null;
  principleAvailable: boolean;
  practice: {
    available: boolean;
    hasRun: boolean;
    lastRun: RunSummary | null;
    passed: boolean;
    passedRunId: string | null;
    passSource: RunSummary['source'] | 'legacy-completed' | null;
  };
  /** Existing explicit chapter completion remains compatible. This flag does
   * not fabricate visits to the new principle steps. */
  completionClaimed: boolean;
  remaining: { principleFrameIds: string[]; needsRun: boolean; needsPassingRun: boolean };
};

type PrincipleRecord = { version: number; seenFrameIds: string[]; lastFrameId: string | null };
type LessonRecord = { lastRun: RunSummary | null; passedRun: RunSummary | null };
type LearningStore = { version: 1; principles: Record<string, PrincipleRecord>; lessons: Record<string, LessonRecord> };
type RunMetadata = { mode?: RunMode; language?: Language; at?: number };

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function readJson(key: string): unknown {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch { return null; }
}
function validSummary(value: unknown): value is RunSummary {
  return object(value) && typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 200 &&
    ['completed', 'failed', 'cancelled'].includes(String(value.status)) && typeof value.passed === 'boolean' &&
    (!value.passed || value.status === 'completed') && typeof value.at === 'number' && Number.isFinite(value.at) && value.at >= 0 &&
    ['recorded-run', 'saved-run'].includes(String(value.source)) &&
    (value.mode === undefined || ['demo', 'live'].includes(String(value.mode))) &&
    (value.language === undefined || ['typescript', 'javascript', 'python'].includes(String(value.language)));
}
function readStore(): LearningStore {
  const result: LearningStore = { version: 1, principles: {}, lessons: {} };
  const raw = readJson(KEY);
  if (!object(raw) || raw.version !== 1) return result;
  if (object(raw.principles)) {
    for (const [id, record] of Object.entries(raw.principles)) {
      const definition = getPrincipleDefinition(id);
      if (!definition || !object(record) || record.version !== definition.version || !Array.isArray(record.seenFrameIds)) continue;
      const allowed = new Set<string>(definition.allowedFrameIds);
      const seen = record.seenFrameIds.filter((frame): frame is string => typeof frame === 'string' && allowed.has(frame));
      result.principles[id] = {
        version: definition.version,
        seenFrameIds: [...new Set(seen)],
        lastFrameId: typeof record.lastFrameId === 'string' && allowed.has(record.lastFrameId) ? record.lastFrameId : null,
      };
    }
  }
  if (object(raw.lessons)) {
    for (const [id, record] of Object.entries(raw.lessons)) {
      if (!getLearningPathItem(id) || !object(record)) continue;
      result.lessons[id] = {
        lastRun: validSummary(record.lastRun) ? record.lastRun : null,
        passedRun: validSummary(record.passedRun) && record.passedRun.passed ? record.passedRun : null,
      };
    }
  }
  return result;
}
function persist(store: LearningStore): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGE_EVENT));
    return true;
  } catch { return false; }
}

function principleProgress(sceneId: string, store: LearningStore): PrincipleProgress {
  const definition = getPrincipleDefinition(sceneId);
  if (!definition) return {
    sceneId, title: '', version: 0, available: false, seenFrameIds: [], remainingFrameIds: [],
    firstUnseenFrameId: null, viewedCount: 0, totalCount: 0, completed: false, lastFrameId: null,
  };
  const record = store.principles[sceneId];
  const seenFrameIds = record?.seenFrameIds ?? [];
  const seen = new Set(seenFrameIds);
  const remainingFrameIds = definition.requiredFrameIds.filter(id => !seen.has(id));
  return {
    sceneId, title: definition.title, version: definition.version, available: true,
    seenFrameIds: [...seenFrameIds], remainingFrameIds,
    firstUnseenFrameId: remainingFrameIds[0] ?? null,
    viewedCount: definition.requiredFrameIds.filter(id => seen.has(id)).length,
    totalCount: definition.requiredFrameIds.length,
    completed: definition.requiredFrameIds.length > 0 && remainingFrameIds.length === 0,
    lastFrameId: record?.lastFrameId ?? null,
  };
}

export function getPrincipleProgress(sceneId: string): PrincipleProgress {
  return principleProgress(sceneId, readStore());
}

/** Call only when this specific frame is actually displayed. Jumping to the
 * final frame never implies that intermediate frames have been visited. */
export function markPrincipleSeen(sceneId: string, frameId: string): boolean {
  const definition = getPrincipleDefinition(sceneId);
  if (!definition || !definition.allowedFrameIds.includes(frameId)) return false;
  const store = readStore();
  const previous = store.principles[sceneId];
  const seenFrameIds = previous?.seenFrameIds ?? [];
  store.principles[sceneId] = {
    version: definition.version,
    seenFrameIds: [...new Set([...seenFrameIds, frameId])],
    lastFrameId: frameId,
  };
  return persist(store);
}

function validRun(value: unknown): value is RunResult {
  return object(value) && typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 200 &&
    ['completed', 'failed', 'cancelled'].includes(String(value.status)) && Array.isArray(value.events) &&
    value.events.every(event => object(event) && typeof event.seq === 'number' && Number.isFinite(event.seq) &&
      typeof event.type === 'string' && typeof event.nodeId === 'string');
}
function summarize(lessonId: string, result: RunResult, meta: RunMetadata, source: RunSummary['source']): RunSummary {
  return {
    id: result.id, status: result.status, passed: validateLessonRun(lessonId, result).passed,
    at: typeof meta.at === 'number' && Number.isFinite(meta.at) && meta.at >= 0 ? meta.at : Date.now(),
    ...(meta.mode && ['demo', 'live'].includes(meta.mode) ? { mode: meta.mode } : {}),
    ...(meta.language && ['typescript', 'javascript', 'python'].includes(meta.language) ? { language: meta.language } : {}),
    source,
  };
}
function latest(items: (RunSummary | null | undefined)[]): RunSummary | null {
  return items.filter((item): item is RunSummary => !!item).sort((a, b) => b.at - a.at)[0] ?? null;
}

/** Record a new execution outcome once the runtime settles. Do not invoke this
 * while playing historical events; reading/replaying never creates a run. */
export function recordLessonRun(lessonId: string, result: RunResult, metadata: RunMetadata = {}): boolean {
  if (getLearningPathItem(lessonId)?.practiceAvailability !== 'available' || !validRun(result)) return false;
  const store = readStore();
  const previous = store.lessons[lessonId];
  const summary = summarize(lessonId, result, metadata, 'recorded-run');
  // Calling twice for the same run cannot move its timestamp or count as a new
  // attempt. Previous successful evidence survives a later failed experiment.
  if (previous?.lastRun?.id === summary.id) summary.at = previous.lastRun.at;
  store.lessons[lessonId] = {
    lastRun: latest([previous?.lastRun, summary]),
    passedRun: latest([previous?.passedRun, ...savedRunSummaries(lessonId).filter(run => run.passed), summary.passed ? summary : null]),
  };
  return persist(store);
}

function legacyCompleted(): Set<string> {
  const raw = readJson(LEGACY_COMPLETED);
  return new Set(Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string' && !!getLearningPathItem(id)) : []);
}
function savedRunSummaries(lessonId: string): RunSummary[] {
  const raw = readJson(LEGACY_RUNS);
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is SavedRun => object(item) && item.lessonId === lessonId && validRun(item))
    .map(run => summarize(lessonId, run, { mode: run.mode, language: run.language, at: Number.isFinite(run.savedAt) && run.savedAt >= 0 ? run.savedAt : 0 }, 'saved-run'));
}

/** Purely derives old and new evidence. No read marks a lesson viewed, writes
 * migrated data, or infers principle visits from an old completion badge. */
export function readLearningState(lessonId: string): LessonLearningState {
  const item = getLearningPathItem(lessonId);
  const store = readStore();
  const record = store.lessons[lessonId];
  const principleAvailable = item?.principleAvailability === 'available' && !!item.principleSceneId;
  const practiceAvailable = item?.practiceAvailability === 'available';
  const principle = principleAvailable ? principleProgress(item!.principleSceneId!, store) : null;
  const saved = item ? savedRunSummaries(lessonId) : [];
  // A legacy savedAt is a save timestamp, not necessarily the execution time.
  // Once actual executions are recorded, a later save of an old replay cannot
  // replace the latest execution status.
  const lastRun = record?.lastRun ?? latest(saved);
  const passedRun = latest([record?.passedRun, record?.lastRun?.passed ? record.lastRun : null, ...saved.filter(run => run.passed)]);
  const completionClaimed = legacyCompleted().has(lessonId);
  const passed = practiceAvailable && (!!passedRun || completionClaimed);
  const hasRun = !!lastRun || !!passedRun;
  const status: LearningStatus = !principleAvailable && !practiceAvailable ? 'unavailable'
    : passed ? 'passed' : hasRun ? 'ran' : principle && principle.seenFrameIds.length > 0 ? 'studying' : 'not-started';
  return {
    lessonId, title: item?.title ?? '', objective: item?.objective ?? '', status,
    principle, principleAvailable,
    practice: {
      available: practiceAvailable, hasRun, lastRun, passed,
      passedRunId: passedRun?.id ?? null,
      passSource: passedRun?.source ?? (passed ? 'legacy-completed' : null),
    },
    completionClaimed,
    remaining: {
      principleFrameIds: principle?.remainingFrameIds ?? [],
      needsRun: practiceAvailable && !hasRun && !completionClaimed,
      needsPassingRun: practiceAvailable && !passed,
    },
  };
}

export function getLearningSummary() {
  const lessons = LEARNING_PATH.map(item => readLearningState(item.lessonId));
  return {
    lessons,
    availablePracticeCount: lessons.filter(item => item.practice.available).length,
    passedPracticeCount: lessons.filter(item => item.practice.available && item.practice.passed).length,
    availablePrincipleCount: lessons.filter(item => item.principleAvailable).length,
    viewedPrincipleCount: lessons.filter(item => item.principle?.completed).length,
    remainingLessonIds: lessons.filter(item => item.remaining.needsPassingRun || item.remaining.principleFrameIds.length > 0).map(item => item.lessonId),
  };
}

/** Covers writes in this tab and other tabs. Existing completion/run writes
 * are observed across tabs; callers can also re-read after their own writes. */
export function subscribeLearningState(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const storageChanged = (event: StorageEvent) => {
    if (event.key === null || [KEY, LEGACY_COMPLETED, LEGACY_RUNS].includes(event.key)) listener();
  };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener('storage', storageChanged);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener('storage', storageChanged);
  };
}
