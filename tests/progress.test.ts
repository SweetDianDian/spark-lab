import test from 'node:test';
import assert from 'node:assert/strict';
import type { RunEvent, RunResult } from '../src/types';
import { nodeExecutionState, validateLessonRun } from '../src/lib/progress';

function event(seq: number, type: string, nodeId: string, data: unknown = null): RunEvent {
  return { id: `event-${seq}`, seq, timestamp: seq, type, nodeId, data, title: type, source: 'runtime' };
}
const model = (seq: number, toolCalls: unknown[] = [], text = '模型回答') => event(seq, 'model.completed', 'model', { text, toolCalls });
const calculator = (seq: number, result = 391) => event(seq, 'tool.completed', 'tool', { name: 'calculator', result: { expression: '17 * 23', result } });
const result = (events: RunEvent[], output: unknown = '模型回答', status: RunResult['status'] = 'completed'): RunResult => ({
  id: 'run-1', events, output, duration: 100, status,
});

test('empty code, manual output, failed or cancelled runs do not complete a chapter', () => {
  assert.equal(validateLessonRun('first-call', null).passed, false);
  assert.equal(validateLessonRun('first-call', result([])).passed, false);
  assert.equal(validateLessonRun('first-call', result([event(1, 'output', 'output', 'hi')], 'hi')).passed, false);
  const events = [model(1), event(2, 'output', 'output', '回答')];
  assert.equal(validateLessonRun('first-call', result(events, '回答', 'failed')).passed, false);
  assert.equal(validateLessonRun('first-call', result(events, '回答', 'cancelled')).passed, false);
  assert.equal(validateLessonRun('first-call', result([...events, event(3, 'run.failed', 'output')])).passed, false);
  assert.equal(validateLessonRun('future-chapter', result(events)).passed, false);
});

test('first call and context require model completion and an actual nonempty output event', () => {
  for (const id of ['first-call', 'context']) {
    assert.equal(validateLessonRun(id, result([event(1, 'model.started', 'model'), event(2, 'output', 'output', 'hello')])).passed, false);
    assert.equal(validateLessonRun(id, result([model(1)])).passed, false);
    for (const empty of ['', '  ', null, undefined, {}, [], { result: '' }]) {
      assert.equal(validateLessonRun(id, result([model(1), event(2, 'output', 'output', empty)], empty)).passed, false);
    }
    assert.equal(validateLessonRun(id, result([model(1), event(2, 'output', 'output', '回答')], '回答')).passed, true);
    assert.equal(validateLessonRun(id, result([event(1, 'output', 'output', '回答'), model(2)])).passed, false);
    assert.equal(validateLessonRun(id, result([model(1), event(2, 'output', 'output', '回答'), event(3, 'output', 'output', '')], '')).passed, false);
  }
});

test('tool chapter requires a requested and completed calculator with a result; zero is valid', () => {
  const requested = model(1, [{ name: 'calculator', arguments: { expression: '17 * 23' } }], '');
  assert.equal(validateLessonRun('tools', result([requested, event(2, 'output', 'output', 'hello')])).passed, false);
  assert.equal(validateLessonRun('tools', result([requested, event(2, 'tool.started', 'tool'), event(3, 'output', 'output', 'hello')])).passed, false);
  assert.equal(validateLessonRun('tools', result([model(1), calculator(2), event(3, 'output', 'output', 391)], 391)).passed, false);
  assert.equal(validateLessonRun('tools', result([requested, calculator(2), event(3, 'output', 'output', { result: 391 })], { result: 391 })).passed, true);
  assert.equal(validateLessonRun('tools', result([requested, calculator(2, 0), event(3, 'output', 'output', 0)], 0)).passed, true);
});

test('Agent must return to the model after a real tool and finish without tool calls', () => {
  const requested = model(1, [{ name: 'calculator', arguments: { expression: '17 * 23' } }], '');
  const happy = [requested, calculator(2), model(3), event(4, 'output', 'output', '模型回答')];
  assert.equal(validateLessonRun('agent-loop', result(happy)).passed, true);
  assert.equal(validateLessonRun('agent-loop', result([requested, calculator(2), event(3, 'output', 'output', '回答')])).passed, false);
  assert.equal(validateLessonRun('agent-loop', result([model(1), model(2), event(3, 'output', 'output', '回答')])).passed, false);
  assert.equal(validateLessonRun('agent-loop', result([requested, calculator(2), model(3, [{ name: 'search' }]), event(4, 'output', 'output', '回答')])).passed, false);
  const limit = '已达到轮数上限，先停下来检查工具结果和上下文。';
  assert.equal(validateLessonRun('agent-loop', result([...happy.slice(0, 3), event(4, 'output', 'output', limit)], limit)).passed, false);
  assert.equal(validateLessonRun('agent-loop', result([requested, model(2), calculator(3), event(4, 'output', 'output', '回答')])).passed, false);
});

test('nodes distinguish start, completion, failure and a later loop iteration', () => {
  assert.equal(nodeExecutionState([], 'model'), 'idle');
  assert.equal(nodeExecutionState([event(1, 'model.started', 'model')], 'model'), 'running');
  assert.equal(nodeExecutionState([event(1, 'model.started', 'model'), model(2)], 'model'), 'completed');
  assert.equal(nodeExecutionState([model(1), event(2, 'model.started', 'model')], 'model'), 'running');
  assert.equal(nodeExecutionState([event(1, 'model.started', 'model'), event(2, 'model.failed', 'model')], 'model'), 'failed');
  assert.equal(nodeExecutionState([event(1, 'tool.started', 'tool'), event(2, 'run.cancelled', 'output')], 'tool'), 'cancelled');
  assert.equal(nodeExecutionState([event(1, 'tool.started', 'tool'), event(2, 'run.failed', 'output')], 'tool'), 'failed');
  assert.equal(nodeExecutionState([model(1), event(2, 'tool.failed', 'tool'), event(3, 'run.failed', 'output')], 'model'), 'completed');
  assert.equal(nodeExecutionState([event(1, 'step', 'model')], 'model'), 'idle');
});

test('input finishes after preparing data or starting model; output needs evidence', () => {
  assert.equal(nodeExecutionState([event(1, 'run.started', 'input')], 'input'), 'running');
  assert.equal(nodeExecutionState([event(1, 'step', 'input')], 'input'), 'completed');
  assert.equal(nodeExecutionState([event(1, 'model.started', 'model')], 'input'), 'completed');
  assert.equal(nodeExecutionState([event(1, 'run.completed', 'output', { output: null })], 'output'), 'idle');
  assert.equal(nodeExecutionState([event(1, 'step', 'output', 'not a result')], 'output'), 'idle');
  assert.equal(nodeExecutionState([event(1, 'output', 'output', 0)], 'output'), 'completed');
  assert.equal(nodeExecutionState([event(1, 'run.completed', 'output', { output: false })], 'output'), 'completed');
  assert.equal(nodeExecutionState([event(1, 'output', 'output', '答案'), event(2, 'run.failed', 'output')], 'output'), 'failed');
  assert.equal(nodeExecutionState([event(1, 'output', 'output', '答案'), event(2, 'run.cancelled', 'output')], 'output'), 'cancelled');
});

test('event ordering uses seq without mutating the original timeline', () => {
  const timeline = [model(2), event(1, 'model.started', 'model')];
  assert.equal(nodeExecutionState(timeline, 'model'), 'completed');
  assert.deepEqual(timeline.map(item => item.seq), [2, 1]);
});
