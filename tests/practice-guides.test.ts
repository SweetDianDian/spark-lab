import test from 'node:test';
import assert from 'node:assert/strict';
import { getPracticeGuide } from '../src/data/practice-guides';
import { CHAPTER_FILMS } from '../src/data/chapter-films';
import { lessons } from '../src/data/lessons';
import { LEARNING_PATH } from '../src/data/learning-path';
import { executeJavascript, type LabAPI } from '../src/runtime/execution';
import { runTool, serializable, simulateModel } from '../src/runtime/core';
import type { Language, ModelRequest } from '../src/types';

const languages: Language[] = ['typescript', 'javascript', 'python'];
const lesson = (id: string) => lessons.find(item => item.id === id)!;
const matchingLines = (source: string, anchor: string) => source.split('\n').filter(line => line.includes(anchor));

test('every chapter film frame bridges to a real executable lesson node, without stale or invented frames', () => {
  assert.equal(lessons.length, 14);
  assert.deepEqual(new Set(LEARNING_PATH.map(item => item.lessonId)), new Set(lessons.map(item => item.id)));
  for (const film of CHAPTER_FILMS) {
    const guide = getPracticeGuide(film.lessonId);
    assert.ok(guide, film.lessonId);
    assert.deepEqual(Object.keys(guide.frames).sort(), film.frames.map(frame => frame.id).sort(), film.lessonId);
    const nodes = new Set(lesson(film.lessonId).nodes.map(node => node.id));
    for (const [id, frame] of Object.entries(guide.frames)) {
      assert.ok(nodes.has(frame.nodeId), `${film.lessonId}/${id}: ${frame.nodeId} is not an executable node`);
      assert.ok(frame.codeHint.length >= 15 && frame.codeHint.length <= 130, `${film.lessonId}/${id}: needs a short, useful explanation`);
    }
    for (const field of ['goal', 'edit', 'observe'] as const) assert.ok(guide[field].length >= 12 && guide[field].length <= 160, `${film.lessonId}/${field}`);
  }
  for (const id of ['unknown', '', '__proto__', 'constructor', 'toString']) assert.equal(getPracticeGuide(id), undefined);
});

test('every provided source anchor selects exactly one meaningful line in each current language starter', () => {
  for (const item of lessons) {
    const guide = getPracticeGuide(item.id)!;
    for (const [id, frame] of Object.entries({ edit: { anchor: guide.editAnchor }, ...guide.frames })) {
      if (!frame.anchor) continue;
      assert.deepEqual(Object.keys(frame.anchor).sort(), [...languages].sort());
      for (const language of languages) {
        const anchor = frame.anchor[language];
        assert.ok(anchor.length >= 5 && !anchor.includes('\n'), `${item.id}/${id}/${language}: must identify one line`);
        assert.equal(matchingLines(item.starter[language], anchor).length, 1, `${item.id}/${id}/${language}: ${anchor}`);
        assert.doesNotMatch(anchor, /lab\.step/, 'a reporting statement must not masquerade as the computation itself');
      }
    }
  }
});

test('editable assignment anchors exclude values and survive changing only that assignment', () => {
  const parameters: Record<string, string> = {
    'first-call': 'question', context: 'history', tools: 'people', 'agent-loop': 'maxSteps',
    tokens: 'temperature', transformer: 'queryStrength', training: 'learningRate', embeddings: 'query',
    rag: 'question', memory: 'preserveCompletedIds', mcp: 'allowCall', evaluation: 'roundAnswers',
    'multi-agent': 'includeSources', capstone: 'people',
  };
  for (const item of lessons) {
    const edit = getPracticeGuide(item.id)!.editAnchor;
    assert.ok(edit, item.id);
    for (const language of languages) {
      const anchor = edit[language];
      assert.match(anchor, new RegExp(`^(?:const )?${parameters[item.id]}(?:\\s*:[^=]+)?\\s*=$`));
      const source = item.starter[language];
      const original = matchingLines(source, anchor)[0];
      const modified = source.replace(original, `${original.slice(0, original.indexOf(anchor))}${anchor} ${language === 'python' ? 'None' : 'null'}${language === 'python' ? '' : ';'}`);
      assert.equal(matchingLines(modified, anchor).length, 1, `${item.id}/${language}: value changes must not break navigation`);
    }
  }
});

test('counterfactual and internal implementation frames explain their actual visibility limits', () => {
  const hide = getPracticeGuide('first-call')!.frames['hide-output'];
  assert.equal(hide.anchor, undefined, 'a deleted statement cannot be reported as an executed line');
  assert.match(hide.codeHint, /假设.*默认.*删后重跑/);
  const validate = getPracticeGuide('tools')!.frames.validate;
  assert.match(validate.codeHint, /运行层内部.*没有独立校验行/);
  assert.match(validate.anchor!.javascript, /lab\.tool/);
  assert.equal(getPracticeGuide('context')!.frames.compare.anchor, undefined);
  assert.match(getPracticeGuide('context')!.frames.compare.codeHint, /两次运行.*不是单次代码/);
  assert.match(getPracticeGuide('memory')!.frames['first-operation'].codeHint, /直接构造.*没有真的付款/);
});

test('core reading and state feedback anchors use the actual language syntax', () => {
  assert.equal(getPracticeGuide('first-call')!.frames.display.anchor!.python, "lab.output(response['text'])");
  assert.equal(getPracticeGuide('first-call')!.frames.display.anchor!.javascript, 'lab.output(response.text)');
  const feedback = getPracticeGuide('agent-loop')!.frames.feedback;
  assert.match(feedback.codeHint, /追加到 history.*下一轮/);
  for (const language of languages) {
    const line = matchingLines(lesson('agent-loop').starter[language], feedback.anchor![language])[0];
    assert.match(line, /result/);
    assert.match(line, /call/);
  }
  assert.match(getPracticeGuide('tools')!.frames.return.codeHint, /没有把结果发回下一轮/);
});

test('guides state local or teaching assumptions and keep unusual outcomes as observations', () => {
  for (const item of lessons) {
    const guide = getPracticeGuide(item.id)!;
    assert.match(`${guide.edit} ${guide.observe}`, /教学|本地|示例/);
    assert.doesNotMatch(`${guide.goal} ${guide.observe}`, /你已掌握|已经通过|本次已成功/);
  }
  assert.match(getPracticeGuide('agent-loop')!.observe, /search 不联网.*真实 API/);
  assert.match(getPracticeGuide('training')!.observe, /没有训练大模型/);
  assert.match(getPracticeGuide('transformer')!.observe, /单头.*不是模型思维/);
  assert.match(getPracticeGuide('mcp')!.observe, /没有远端 MCP.*自定义码/);
  assert.match(getPracticeGuide('multi-agent')!.observe, /不是两个自主模型.*没有真实并行/);
  assert.match(getPracticeGuide('evaluation')!.observe, /只证明这三例/);
});

async function runCore(id: string, language: 'javascript' | 'typescript', code = lesson(id).starter[language]) {
  const requests: ModelRequest[] = [];
  const outputs: unknown[] = [];
  const steps: { id: string; data: unknown }[] = [];
  const tools: string[] = [];
  const lab: LabAPI = {
    model: async request => {
      requests.push(serializable(request) as ModelRequest);
      return simulateModel(request);
    },
    tool: async (name, args) => { tools.push(name); return runTool(name, args); },
    output: value => { outputs.push(serializable(value)); },
    log: () => {},
    step: (id, _title, data) => { steps.push({ id, data: serializable(data) }); },
  };
  await executeJavascript(code, language, lab);
  return { requests, outputs, steps, tools };
}

for (const language of ['typescript', 'javascript'] as const) {
  test(`${language}: first-call question intervention and missing-display counterfactual do what the guide describes`, async () => {
    const source = lesson('first-call').starter[language];
    const before = await runCore('first-call', language);
    const after = await runCore('first-call', language, source.replace('用一句话解释什么是大语言模型。', '用一句话解释什么是 Agent。'));
    assert.equal(before.requests.length, 1);
    assert.equal(after.requests.length, 1);
    assert.notEqual(after.requests[0].prompt, before.requests[0].prompt);
    assert.notDeepEqual(after.outputs, before.outputs);
    assert.match(String(after.outputs[0]), /Agent/);
    const outputLine = matchingLines(source, getPracticeGuide('first-call')!.frames.display.anchor![language])[0];
    const hidden = await runCore('first-call', language, source.replace(outputLine, ''));
    assert.equal(hidden.requests.length, 1);
    assert.deepEqual(hidden.outputs, []);
  });

  test(`${language}: context intervention removes both messages while keeping the other request fields`, async () => {
    const source = lesson('context').starter[language];
    const anchor = getPracticeGuide('context')!.editAnchor![language];
    const start = source.indexOf(anchor) + anchor.length;
    const end = source.indexOf('];', start) + 1;
    const changed = source.slice(0, start) + ' []' + source.slice(end);
    const before = (await runCore('context', language)).requests[0];
    const after = (await runCore('context', language, changed)).requests[0];
    assert.equal(before.history?.length, 2);
    assert.deepEqual(after.history, []);
    assert.equal(after.prompt, before.prompt);
    assert.equal(after.system, before.system);
  });

  test(`${language}: changing people follows actual tool execution to a fresh output`, async () => {
    const anchor = getPracticeGuide('tools')!.editAnchor![language];
    const source = lesson('tools').starter[language];
    const before = await runCore('tools', language);
    const after = await runCore('tools', language, source.replace(`${anchor} 17`, `${anchor} 19`));
    assert.deepEqual(before.outputs, [{ expression: '17 * 23', result: 391 }]);
    assert.deepEqual(after.outputs, [{ expression: '19 * 23', result: 437 }]);
    assert.deepEqual(after.tools, ['calculator']);
  });

  test(`${language}: two-round Agent intervention stops without pretending to produce the final summary`, async () => {
    const source = lesson('agent-loop').starter[language];
    const anchor = getPracticeGuide('agent-loop')!.editAnchor![language];
    const before = await runCore('agent-loop', language);
    const after = await runCore('agent-loop', language, source.replace(`${anchor} 3`, `${anchor} 2`));
    assert.equal(before.requests.length, 3);
    assert.equal(after.requests.length, 2);
    assert.deepEqual(after.tools, ['search', 'calculator']);
    assert.match(JSON.stringify(after.requests[1].history), /工具返回.*search/);
    assert.match(String(after.outputs[0]), /^已达到轮数上限/);
    assert.doesNotMatch(String(before.outputs[0]), /^已达到轮数上限/);
  });
}
