import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectExecution } from '../src/lib/execution-inspector';
import { getStoryStarter } from '../src/lib/tool-story';
import { lessons } from '../src/data/lessons';
import type { Language, RunEvent } from '../src/types';
import { executeJavascript, type LabAPI } from '../src/runtime/execution';
import { runTool, serializable, simulateModel } from '../src/runtime/core';
const event = (seq: number, type: string, nodeId: string, data: unknown): RunEvent => ({ id: `e${seq}`, seq, type, nodeId, data, title: type, timestamp: seq, source: 'runtime' });
const value = { expression: '19 * 23', result: 437 };
const events = [
  event(1, 'step', 'input', { people: 19, price: 23 }),
  event(2, 'model.started', 'model', { prompt: '19 * 23', tools: ['calculator'] }),
  event(3, 'model.completed', 'model', { text: '', toolCalls: [{ name: 'calculator', arguments: { expression: '19 * 23' } }] }),
  event(4, 'tool.started', 'tool', { name: 'calculator', arguments: { expression: '19 * 23' } }),
  event(5, 'tool.completed', 'tool', { name: 'calculator', result: value }),
  event(6, 'output', 'output', value),
];
const inspect = (nodeId: string, code = getStoryStarter('typescript', 19), timeline = events, language: Language = 'typescript', matchesSnapshot = true) => inspectExecution({ lessonId: 'tools', nodeId, code, events: timeline, language, matchesSnapshot });

test('tool node pairs actual arguments/result and maps the executing call, not mentions', () => {
  const code = "// 🧰 lab.tool() is only mentioned here\nconst text = 'lab.tool(fake)';\nconst pattern = /lab.tool(fake)/;\n" + getStoryStarter('typescript', 19);
  const result = inspect('tool', code);
  assert.deepEqual(result.input, { name: 'calculator', arguments: { expression: '19 * 23' } });
  assert.deepEqual(result.result, value);
  assert.equal(result.location?.startLine, code.split('\n').findIndex(line => line.includes('await lab.tool')) + 1);
  assert.equal(result.location?.kind, 'matched');
});

test('all three languages locate the actual tool-output branch instead of the first textual match', () => {
  for (const language of ['typescript', 'javascript', 'python'] as const) {
    const code = getStoryStarter(language, 19);
    const output = inspect('output', code, events, language);
    assert.equal(output.location?.startLine, code.split('\n').findIndex(line => line.includes('lab.output(result)')) + 1);
    assert.deepEqual(output.result, value);
  }
});

test('no-tool responses locate the text output branch', () => {
  const timeline = [event(1, 'model.started', 'model', { prompt: 'hello' }), event(2, 'model.completed', 'model', { text: 'hello!', toolCalls: [] }), event(3, 'output', 'output', 'hello!')];
  for (const language of ['typescript', 'python'] as const) {
    const code = getStoryStarter(language, 19);
    const result = inspect('output', code, timeline, language);
    assert.equal(result.location?.startLine, code.split('\n').findIndex(line => /lab.output\(response/.test(line)) + 1);
  }
});

test('an Agent limit output maps to the stop branch, not a model answer branch', () => {
  const code = lessons.find(item => item.id === 'agent-loop')!.starter.typescript;
  const limit = '已达到轮数上限，先停下来检查工具结果和上下文。';
  const timeline = [...events.slice(0, 5), event(6, 'output', 'output', limit)];
  const result = inspect('output', code, timeline);
  assert.equal(result.location?.startLine, code.split('\n').findIndex(line => line.includes('lab.output(') && line.includes('已达到')) + 1);
  assert.match(result.explanation, /不代表.*完成/);
});

test('edited code is never highlighted as the source of old execution evidence', () => {
  const result = inspect('tool', getStoryStarter('typescript', 20), events, 'typescript', false);
  assert.equal(result.location, null);
  assert.match(result.locationNote, /旧证据/);
  assert.deepEqual(result.result, value);
});

test('duplicate tool call sites and unknown output expressions remain ambiguous', () => {
  assert.equal(inspect('tool', 'await lab.tool(a,b);\nawait lab.tool(c,d);').location, null);
  assert.equal(inspect('output', 'lab.output(result);\nlab.output(other);').location, null);
});

test('latest invocation never reuses the preceding model/tool result', () => {
  const timeline = [...events, event(7, 'tool.started', 'tool', { name: 'search', arguments: { query: 'RAG' } })];
  const result = inspect('tool', getStoryStarter('typescript', 19), timeline);
  assert.equal(result.state, 'running');
  assert.deepEqual(result.input, { name: 'search', arguments: { query: 'RAG' } });
  assert.equal(result.result, null);
});

test('runtime errors and cancellation stay distinct from successful result data', () => {
  const started = events.slice(0, 4);
  const failed = inspect('tool', undefined, [...started, event(5, 'tool.failed', 'tool', { error: 'invalid expression' }), event(6, 'run.failed', 'output', { error: 'invalid expression' })]);
  assert.equal(failed.state, 'failed');
  assert.deepEqual(failed.result, { error: 'invalid expression' });
  const stopped = inspect('tool', undefined, [...started, event(5, 'run.cancelled', 'output', { error: 'stopped' })]);
  assert.equal(stopped.state, 'cancelled');
  assert.deepEqual(stopped.result, { error: 'stopped' });
});

test('logs do not replace the semantic input step, and unexecuted nodes only show related code', () => {
  const input = inspect('input', undefined, [...events, event(7, 'log', 'input', 'debug text')]);
  assert.deepEqual(input.input, { people: 19, price: 23 });
  const fresh = inspect('tool', undefined, []);
  assert.equal(fresh.location?.kind, 'related');
  assert.equal(fresh.result, null);
});

test('all first four starters supply a unique input/model location, even across multiline Python calls', () => {
  for (const lesson of lessons.filter(item => item.nodes.some(node => node.id === 'model'))) {
    for (const language of ['typescript', 'javascript', 'python'] as const) {
      for (const nodeId of ['input', 'model']) {
        const result = inspectExecution({ lessonId: lesson.id, nodeId, code: lesson.starter[language], language, events: [], matchesSnapshot: true });
        assert.ok(result.location, `${lesson.id} ${language} ${nodeId}`);
      }
    }
  }
});

async function executeWithEvents(code: string, language: Language): Promise<RunEvent[]> {
  const actual: RunEvent[] = [];
  const emit = (type: string, nodeId: string, data: unknown) => actual.push(event(actual.length + 1, type, nodeId, serializable(data)));
  const lab: LabAPI = {
    model: async request => { emit('model.started', 'model', request); const response = simulateModel(request); emit('model.completed', 'model', response); return response; },
    tool: async (name, args) => { emit('tool.started', 'tool', { name, arguments: args }); const result = runTool(name, args); emit('tool.completed', 'tool', { name, result }); return result; },
    step: (nodeId, _title, data) => { emit('step', nodeId, data); },
    log: value => { emit('log', 'input', value); },
    output: value => { emit('output', 'output', value); },
  };
  await executeJavascript(code, language, lab);
  return actual;
}

test('story programs actually execute 17→391 and 19→437, with tool and output associations', async () => {
  for (const language of ['typescript', 'javascript'] as const) {
    for (const people of [17, 19]) {
      const code = getStoryStarter(language, people);
      const actual = await executeWithEvents(code, language);
      const tool = inspectExecution({ lessonId: 'tools', nodeId: 'tool', events: actual, code, language, matchesSnapshot: true });
      const output = inspectExecution({ lessonId: 'tools', nodeId: 'output', events: actual, code, language, matchesSnapshot: true });
      assert.deepEqual(tool.result, { expression: `${people} * 23`, result: people * 23 });
      assert.deepEqual(output.result, tool.result);
      assert.equal(code.split('\n')[tool.location!.startLine - 1].includes('await lab.tool('), true);
      assert.equal(code.split('\n')[output.location!.startLine - 1].includes('lab.output(result)'), true);
    }
  }
});

test('all four executed JS/TS starters associate their actual output, including Agent final answer', async () => {
  for (const lesson of lessons.filter(item => item.nodes.some(node => node.id === 'model'))) {
    for (const language of ['typescript', 'javascript'] as const) {
      const code = lesson.starter[language];
      const actual = await executeWithEvents(code, language);
      const output = inspectExecution({ lessonId: lesson.id, nodeId: 'output', events: actual, code, language, matchesSnapshot: true });
      assert.ok(output.result, `${lesson.id} ${language}`);
      assert.equal(output.location?.kind, 'matched', `${lesson.id} ${language}`);
      assert.equal(code.split('\n')[output.location!.startLine - 1].includes('lab.output('), true);
    }
  }
});

test('an actual shortened Agent run locates the limit branch and describes search generically', async () => {
  const code = lessons.find(item => item.id === 'agent-loop')!.starter.typescript.replace(/(maxSteps(?:\s*:\s*number)?\s*=\s*)3/, '$12');
  const actual = await executeWithEvents(code, 'typescript');
  assert.equal(actual.filter(item => item.type === 'model.completed').length, 2);
  const output = inspectExecution({ lessonId: 'agent-loop', nodeId: 'output', events: actual, code, language: 'typescript', matchesSnapshot: true });
  assert.match(String(output.result), /已达到.*轮数上限/);
  assert.equal(code.split('\n')[output.location!.startLine - 1].includes('已达到'), true);
  const firstModel = actual.findIndex(item => item.type === 'model.completed');
  const model = inspectExecution({ lessonId: 'agent-loop', nodeId: 'model', events: actual.slice(0, firstModel + 1), code, language: 'typescript', matchesSnapshot: true });
  assert.match(model.explanation, /对应工具/);
  assert.doesNotMatch(model.explanation, /计算器/);
});

test('chapter-specific computations match a literal tagged step and show its own recorded values', () => {
  const timeline = [event(1, 'step', 'input', { temperature: .7 }), event(2, 'step', 'sample', { input: { draw: .8 }, result: { selected: '结束' } }), event(3, 'output', 'output', '结束')];
  for (const language of ['python', 'typescript', 'javascript'] as const) {
    const code = "lab.step('input', '开头', {})\nlab.step('sample', '抽取', {})\nlab.output('结束')";
    const args = { lessonId: 'tokens', localSteps: true, events: timeline, language, code, matchesSnapshot: true } as const;
    const sampled = inspectExecution({ ...args, nodeId: 'sample' });
    assert.equal(sampled.location?.startLine, 2);
    assert.deepEqual(sampled.input, { draw: .8 });
    assert.deepEqual(sampled.result, { selected: '结束' });
    assert.equal(inspectExecution({ ...args, nodeId: 'tokenize' }).event, undefined);
    assert.equal(inspectExecution({ ...args, nodeId: 'input' }).result, null);
    assert.deepEqual(inspectExecution({ ...args, nodeId: 'output' }).input, { selected: '结束' });
  }
});
