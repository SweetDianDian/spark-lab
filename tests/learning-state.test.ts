import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getPrincipleDefinition } from '../src/data/learning-path';
import { getLearningSummary, getPrincipleProgress, markPrincipleSeen, readLearningState, recordLessonRun, subscribeLearningState } from '../src/lib/learning-state';
import type { RunEvent, RunResult, SavedRun } from '../src/types';

const KEY = 'spark-lab:v1:learning-state';
class MemoryStorage {
  values = new Map<string, string>();
  writes = 0;
  fail = false;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { if (this.fail) throw new Error('Quota exceeded'); this.writes++; this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}
let storage: MemoryStorage;
let storageDescriptor: PropertyDescriptor | undefined;
let windowDescriptor: PropertyDescriptor | undefined;
beforeEach(() => {
  storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
});
afterEach(() => {
  if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
  else Reflect.deleteProperty(globalThis, 'localStorage');
  if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor);
  else Reflect.deleteProperty(globalThis, 'window');
});
function event(seq: number, type: string, nodeId: string, data: unknown): RunEvent {
  return { id: `e-${seq}`, seq, timestamp: seq, type, nodeId, data, title: type, source: 'runtime' };
}
function run(id = 'run-1', status: RunResult['status'] = 'completed'): RunResult {
  return {
    id, status, duration: 10, output: '回答', events: [
      event(1, 'model.completed', 'model', { text: '回答', toolCalls: [] }),
      event(2, 'output', 'output', '回答'),
      event(3, `run.${status}`, 'output', { output: '回答' }),
    ],
  };
}
function saved(id = 'old-run', savedAt = 100): SavedRun {
  return { ...run(id), lessonId: 'first-call', language: 'typescript', code: 'original code', mode: 'demo', savedAt, title: '旧实验' };
}

test('reading a new course is side-effect free and leaves both axes untouched', () => {
  const state = readLearningState('first-call');
  assert.equal(state.status, 'not-started');
  assert.equal(state.principle?.sceneId, 'api-call');
  assert.equal(state.principle?.viewedCount, 0);
  assert.equal(state.practice.hasRun, false);
  assert.equal(state.practice.passed, false);
  assert.equal(state.remaining.needsRun, true);
  assert.equal(storage.writes, 0);
});

test('jumping to the last frame counts only that actual frame, not skipped frames', () => {
  const definition = getPrincipleDefinition('tools')!;
  const finalFrame = definition.requiredFrameIds.at(-1)!;
  assert.equal(markPrincipleSeen('tools', finalFrame), true);
  const progress = getPrincipleProgress('tools');
  assert.equal(progress.viewedCount, 1);
  assert.equal(progress.totalCount, 5);
  assert.equal(progress.completed, false);
  assert.equal(progress.firstUnseenFrameId, definition.requiredFrameIds[0]);
  assert.deepEqual(progress.seenFrameIds, [finalFrame]);
  assert.equal(progress.lastFrameId, finalFrame);
});

test('repeated views are deduplicated and only all required frames finish a principle', () => {
  const definition = getPrincipleDefinition('context')!;
  for (const frame of definition.requiredFrameIds) {
    assert.equal(markPrincipleSeen('context', frame), true);
    assert.equal(markPrincipleSeen('context', frame), true);
  }
  const progress = getPrincipleProgress('context');
  assert.equal(progress.viewedCount, definition.requiredFrameIds.length);
  assert.equal(progress.completed, true);
  assert.equal(progress.firstUnseenFrameId, null);
  assert.deepEqual(progress.remainingFrameIds, []);
  const course = readLearningState('context');
  assert.equal(course.status, 'studying');
  assert.equal(course.practice.passed, false);
  assert.equal(course.remaining.needsRun, true);
});

test('an early-stop branch cannot stand in for Agent final answer steps', () => {
  assert.equal(markPrincipleSeen('agent', 'stop:1'), true);
  const progress = getPrincipleProgress('agent');
  assert.equal(progress.viewedCount, 0);
  assert.equal(progress.totalCount, 9);
  assert.equal(progress.completed, false);
  assert.equal(progress.lastFrameId, 'stop:1');
  assert.equal(readLearningState('agent-loop').status, 'studying');
});

test('sampling stays attached to tokens while its new code practice needs independent evidence', () => {
  markPrincipleSeen('sampling', 'input');
  const tokens = readLearningState('tokens');
  assert.equal(tokens.status, 'studying');
  assert.equal(tokens.principleAvailable, true);
  assert.equal(tokens.practice.available, true);
  assert.equal(tokens.remaining.needsPassingRun, true);
  assert.equal(readLearningState('first-call').principle?.viewedCount, 0);
  assert.equal(recordLessonRun('tokens', run()), true);
  assert.equal(readLearningState('tokens').practice.passed, false);
});

test('actual unsuccessful outcomes are recorded without granting a pass', () => {
  const empty = { ...run(), events: [], output: 'hi' };
  assert.equal(recordLessonRun('first-call', empty, { at: 20 }), true);
  assert.equal(readLearningState('first-call').status, 'ran');
  assert.equal(readLearningState('first-call').practice.passed, false);
  assert.equal(recordLessonRun('first-call', run('cancelled-run', 'cancelled'), { at: 30 }), true);
  assert.equal(readLearningState('first-call').practice.lastRun?.status, 'cancelled');
  assert.equal(readLearningState('first-call').remaining.needsPassingRun, true);
});

test('a later failure remains visible without erasing a previous verified pass', () => {
  recordLessonRun('first-call', run('success'), { at: 10, mode: 'demo', language: 'python' });
  recordLessonRun('first-call', run('failure', 'failed'), { at: 20 });
  const state = readLearningState('first-call');
  assert.equal(state.status, 'passed');
  assert.equal(state.practice.lastRun?.id, 'failure');
  assert.equal(state.practice.lastRun?.status, 'failed');
  assert.equal(state.practice.passedRunId, 'success');
  assert.equal(state.practice.passSource, 'recorded-run');
  assert.equal(state.completionClaimed, false);
  assert.equal(state.principle?.viewedCount, 0);
});

test('a repeated run ID does not receive a new timestamp', () => {
  recordLessonRun('context', run('same'), { at: 100 });
  recordLessonRun('context', run('same'), { at: 200 });
  assert.equal(readLearningState('context').practice.lastRun?.at, 100);
});

test('legacy completion badges are retained without inventing any viewed frames or run evidence', () => {
  storage.setItem('spark-lab:v1:completed', JSON.stringify(['first-call', 'missing-id', 3]));
  const before = storage.writes;
  const state = readLearningState('first-call');
  assert.equal(state.status, 'passed');
  assert.equal(state.practice.passSource, 'legacy-completed');
  assert.equal(state.practice.passedRunId, null);
  assert.equal(state.practice.hasRun, false);
  assert.equal(state.principle?.viewedCount, 0);
  assert.equal(state.completionClaimed, true);
  assert.equal(storage.writes, before);
});

test('saved legacy runs are validated, and merely replaying/reading never records a new attempt', () => {
  storage.setItem('spark-lab:v1:runs', JSON.stringify([saved(), { ...saved('bad'), events: [], output: null }]));
  const before = storage.writes;
  const first = readLearningState('first-call');
  const second = readLearningState('first-call');
  assert.equal(first.practice.passed, true);
  assert.equal(first.practice.passSource, 'saved-run');
  assert.equal(first.practice.passedRunId, 'old-run');
  assert.deepEqual(first, second);
  assert.equal(first.completionClaimed, false);
  assert.equal(storage.writes, before);
});

test('new summaries preserve legacy passed evidence when notebook history is later pruned', () => {
  storage.setItem('spark-lab:v1:runs', JSON.stringify([saved()]));
  recordLessonRun('first-call', run('new-failure', 'failed'), { at: 200 });
  storage.removeItem('spark-lab:v1:runs');
  assert.equal(readLearningState('first-call').practice.passedRunId, 'old-run');
  assert.equal(readLearningState('first-call').practice.lastRun?.id, 'new-failure');
});

test('saving an old replay later cannot replace the latest actual execution', () => {
  recordLessonRun('first-call', run('new-failure', 'failed'), { at: 200 });
  storage.setItem('spark-lab:v1:runs', JSON.stringify([saved('old-run', 5000)]));
  assert.equal(readLearningState('first-call').practice.lastRun?.id, 'new-failure');
  assert.equal(readLearningState('first-call').practice.passed, true);
});

test('unknown IDs, malformed records and missing storage never crash readers', () => {
  for (const broken of ['{', 'null', '[]', '{"version":1,"principles":[],"lessons":{"first-call":null}}']) {
    storage.setItem(KEY, broken);
    storage.setItem('spark-lab:v1:runs', '{"not":"an array"}');
    storage.setItem('spark-lab:v1:completed', 'null');
    assert.doesNotThrow(() => getLearningSummary());
  }
  storage.setItem('spark-lab:v1:runs', JSON.stringify([null, 3, {}, { ...saved(), events: [null] }]));
  assert.doesNotThrow(() => readLearningState('first-call'));
  assert.equal(readLearningState('unknown').status, 'unavailable');
  assert.equal(getPrincipleProgress('unknown').available, false);
  assert.equal(markPrincipleSeen('tools', 'unknown-frame'), false);
  assert.equal(recordLessonRun('unknown', run()), false);
  assert.equal(recordLessonRun('first-call', { events: [null] } as unknown as RunResult), false);
  Reflect.deleteProperty(globalThis, 'localStorage');
  assert.doesNotThrow(() => getLearningSummary());
  assert.equal(markPrincipleSeen('tools', 'input'), false);
});

test('a changed principle version invalidates stale step evidence instead of faking completion', () => {
  storage.setItem(KEY, JSON.stringify({ version: 1, lessons: {}, principles: { tools: {
    version: 999, seenFrameIds: ['input', 'request', 'validate', 'calculate', 'answer'], lastFrameId: 'answer',
  } } }));
  assert.equal(getPrincipleProgress('tools').viewedCount, 0);
  assert.equal(getPrincipleProgress('tools').completed, false);
});

test('storage failures return false and do not announce or persist success', () => {
  markPrincipleSeen('tools', 'input');
  const original = storage.getItem(KEY);
  storage.fail = true;
  assert.equal(markPrincipleSeen('tools', 'request'), false);
  assert.equal(recordLessonRun('first-call', run()), false);
  assert.equal(storage.getItem(KEY), original);
  assert.equal(getPrincipleProgress('tools').viewedCount, 1);
});

test('subscribers receive current-tab and relevant other-tab changes, then clean up', () => {
  const target = new EventTarget();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
  let calls = 0;
  const unsubscribe = subscribeLearningState(() => { calls++; });
  markPrincipleSeen('tools', 'input');
  assert.equal(calls, 1);
  const event = new Event('storage'); Object.defineProperty(event, 'key', { value: 'spark-lab:v1:completed' });
  target.dispatchEvent(event);
  assert.equal(calls, 2);
  unsubscribe();
  markPrincipleSeen('tools', 'request');
  assert.equal(calls, 2);
});
