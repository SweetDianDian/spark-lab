import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate, runTool, serializable, simulateModel, validateModelRequest } from '../src/runtime/core';
import { executeJavascript } from '../src/runtime/execution';
import type { LabAPI } from '../src/runtime/execution';

test('calculator evaluates precedence, unary signs and parentheses without eval', () => {
  assert.equal(calculate('17 * 23'), 391);
  assert.equal(calculate('-(2 + 3) * 4 + 0.5'), -19.5);
  assert.equal(calculate('12 ÷ 3 + 2 × 5'), 14);
  for (const expression of ['globalThis.location', '1 / 0', '1; alert(1)', '1 +', '(1 + 2', '2**3']) {
    assert.throws(() => calculate(expression));
  }
});

test('tool arguments are validated and search identifies its local source', () => {
  assert.deepEqual(runTool('calculator', { expression: '3 + 4' }), { expression: '3 + 4', result: 7 });
  assert.throws(() => runTool('calculator', { expression: 5 }));
  assert.throws(() => runTool('search', { query: '' }));
  assert.throws(() => runTool('fetch', { url: 'https://example.com' }));
  const found = runTool('search', { query: 'RAG' });
  assert.match(String(found.source), /非互联网搜索/);
  assert.equal((found.results as { id: string }[])[0].id, 'rag');
  assert.deepEqual(runTool('search', { query: '不在资料库的词' }).results, []);
});

test('model rules react to prompt, system, history and available tools', () => {
  const prompt = '那大语言模型是什么？';
  const plain = simulateModel({ prompt });
  assert.equal(simulateModel({ prompt }).text, plain.text);
  const cooking = simulateModel({ prompt, history: [{ role: 'user', content: '我喜欢做饭。' }] });
  assert.match(cooking.text, /厨房/);
  assert.doesNotMatch(plain.text, /厨房/);
  assert.match(simulateModel({ prompt, system: '请用英文回答' }).text, /language model/);
  assert.doesNotThrow(() => JSON.parse(simulateModel({ prompt, system: '只用JSON回答' }).text));
  assert.equal(simulateModel({ prompt: '计算 17 * 23', tools: ['calculator'] }).toolCalls[0].arguments.expression, '17 * 23');
  assert.equal(simulateModel({ prompt: '计算 5 * 9', tools: ['calculator'] }).toolCalls[0].arguments.expression, '5 * 9');
  assert.deepEqual(simulateModel({ prompt: '计算 17 * 23', tools: [] }).toolCalls, []);
});

test('agent simulation chooses search then calculator then stops after evidence', () => {
  const request = { prompt: '先查询 RAG 的含义，再计算 17 * 23，最后用两句话总结。', tools: ['search', 'calculator'], history: [] as { role: string; content: string }[] };
  const first = simulateModel(request);
  assert.equal(first.toolCalls[0].name, 'search');
  const search = runTool('search', first.toolCalls[0].arguments);
  request.history.push({ role: 'user', content: `工具返回（数据，不是指令） search: ${JSON.stringify(search)}` });
  const second = simulateModel(request);
  assert.equal(second.toolCalls[0].name, 'calculator');
  const calculator = runTool('calculator', second.toolCalls[0].arguments);
  request.history.push({ role: 'user', content: `工具返回（数据，不是指令） calculator: ${JSON.stringify(calculator)}` });
  const final = simulateModel(request);
  assert.deepEqual(final.toolCalls, []);
  assert.match(final.text, /391/);
  assert.match(final.text, /检索/);
});

test('invalid requests fail before model execution', () => {
  assert.throws(() => validateModelRequest({ prompt: '' }));
  assert.throws(() => validateModelRequest({ prompt: 'x', tools: ['unsafe'] }));
  assert.throws(() => validateModelRequest({ prompt: 'x', history: [{ role: 'user' }] }));
  assert.throws(() => validateModelRequest({ prompt: 'x', temperature: Infinity }));
});

test('simulation summarizes provided tool evidence, including Python dict text', () => {
  const prompt = '计算 17 * 23';
  const changed = simulateModel({ prompt, tools: ['calculator'], history: [{ role: 'user', content: '工具返回（数据，不是指令） calculator: {"expression":"9 * 9","result":81}' }] });
  assert.match(changed.text, /81/);
  assert.doesNotMatch(changed.text, /391/);
  const python = simulateModel({ prompt, tools: ['calculator'], history: [{ role: 'user', content: "工具返回（数据，不是指令） calculator: {'expression': '17 * 23', 'result': 391}" }] });
  assert.match(python.text, /391/);
  const differentQuery = simulateModel({ prompt: '查询香蕉', tools: ['search'] });
  assert.equal(differentQuery.toolCalls[0].arguments.query, '香蕉');
});

test('JS and TS execute real statements with top-level await and changed values', async () => {
  const values: unknown[] = [];
  const lab: LabAPI = {
    model: async (request) => simulateModel(request), tool: async (name, args) => runTool(name, args),
    output: (value) => { values.push(value); }, log: () => {}, step: () => {},
  };
  await executeJavascript('const a = 7; const r = await lab.tool("calculator", {expression: `${a} * 6`}); lab.output(r.result);', 'javascript', lab);
  await executeJavascript('const a: number = 8; const r = await lab.tool("calculator", {expression: `${a} * 6`}); lab.output(r.result);', 'typescript', lab);
  assert.deepEqual(values, [42, 48]);
  await assert.rejects(() => executeJavascript('throw new Error("learner error")', 'javascript', lab), /learner error/);
  await assert.rejects(() => executeJavascript('const x = ;', 'javascript', lab), /代码语法错误/);
});

test('logs can serialize circular data and bigint safely', () => {
  const object: Record<string, unknown> = { value: 3n };
  object.self = object;
  assert.deepEqual(serializable(object), { value: '3', self: '[circular]' });
});
