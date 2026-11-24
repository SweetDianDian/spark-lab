import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAPTER_FILMS, FIRST_CALL_EXAMPLE, clampFilmFrame, getChapterFilm, pickFilmToken, softmaxForFilm } from '../src/data/chapter-films';
import { LEARNING_PATH } from '../src/data/learning-path';
import { getAdvancedLab } from '../src/data/advanced-labs';
import { getLesson } from '../src/data/lessons';
import { simulateModel } from '../src/runtime/core';
import { executeJavascript } from '../src/runtime/execution';
import type { ModelRequest, ModelResponse } from '../src/types';

async function runStarter<T>(id: string, from?: string, to?: string): Promise<T> {
  const code = getAdvancedLab(id)!.starter.javascript;
  let output: unknown;
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  await new AsyncFunction('lab', from ? code.replace(from, to!) : code)({ step() {}, output(value: unknown) { output = value; } });
  return output as T;
}

test('every real lesson has its own versioned, navigable teaching film', () => {
  assert.deepEqual(new Set(CHAPTER_FILMS.map(film => film.lessonId)), new Set(LEARNING_PATH.map(lesson => lesson.lessonId)));
  assert.equal(CHAPTER_FILMS.length, LEARNING_PATH.length);
  assert.equal(new Set(CHAPTER_FILMS.map(film => film.question)).size, LEARNING_PATH.length);
  for (const film of CHAPTER_FILMS) {
    assert.ok(Number.isInteger(film.version) && film.version >= 1);
    assert.ok(film.frames.length >= 4, film.lessonId);
    assert.equal(new Set(film.frames.map(frame => frame.id)).size, film.frames.length);
    assert.ok(film.note.length > 10);
    assert.ok(film.goal.length >= 10, `${film.lessonId}: no observable learning goal`);
    assert.equal(new Set(film.frames.map(frame => frame.title)).size, film.frames.length, `${film.lessonId}: ambiguous scene labels`);
    const nodeIds = new Set(film.nodes.map(node => node.id));
    for (const link of film.links) {
      assert.ok(nodeIds.has(link.from), `${film.lessonId}: missing link source`);
      assert.ok(nodeIds.has(link.to), `${film.lessonId}: missing link target`);
    }
    for (const frame of film.frames) {
      assert.ok(frame.action && frame.cause && frame.evidence.length, `${film.lessonId}/${frame.id}: no causal evidence`);
      assert.ok(frame.title.length >= 2 && frame.title.length <= 10, `${film.lessonId}/${frame.id}: scene label is not scannable`);
      for (const id of [...frame.active, ...Object.keys(frame.values)]) assert.ok(nodeIds.has(id), `${film.lessonId}/${frame.id}: missing node ${id}`);
      for (const transfer of frame.transfers ?? []) {
        assert.ok(nodeIds.has(transfer.from) && nodeIds.has(transfer.to));
        assert.ok(film.links.some(link => link.from === transfer.from && link.to === transfer.to), `${film.lessonId}/${frame.id}: no route for moving data`);
      }
      assert.ok(frame.visual || film.nodes.length > 0, `${film.lessonId}: empty diagram`);
    }
  }
  assert.equal(getChapterFilm('not-a-course'), undefined);
});

test('first-call film explains the actual starter fields and ends with the same one-variable exercise', async () => {
  const starter = getLesson('first-call')!.starter.javascript;
  const run = async (code: string) => {
    const requests: ModelRequest[] = [];
    const logs: unknown[] = [];
    const outputs: unknown[] = [];
    const inputs: unknown[] = [];
    let response: ModelResponse | undefined;
    await executeJavascript(code, 'javascript', {
      model: async request => { requests.push(request); response = simulateModel(request); return response; },
      step: (_node, _title, data) => { inputs.push(data); },
      log: data => { logs.push(data); }, output: data => { outputs.push(data); },
      tool: async () => { throw new Error('The first-call starter must not execute tools'); },
    });
    return { requests, logs, outputs, inputs, response };
  };
  const baseline = await run(starter);
  assert.deepEqual(baseline.requests, [{ prompt: FIRST_CALL_EXAMPLE.question }]);
  assert.deepEqual(baseline.inputs, [{ question: FIRST_CALL_EXAMPLE.question }]);
  assert.deepEqual(baseline.response, { text: FIRST_CALL_EXAMPLE.answer, toolCalls: [] });
  assert.deepEqual(baseline.logs, [baseline.response]);
  assert.deepEqual(baseline.outputs, [FIRST_CALL_EXAMPLE.answer]);

  const changed = await run(starter.replace(FIRST_CALL_EXAMPLE.question, FIRST_CALL_EXAMPLE.changedQuestion));
  assert.deepEqual(changed.inputs, [{ question: FIRST_CALL_EXAMPLE.changedQuestion }]);
  assert.deepEqual(changed.requests, [{ prompt: FIRST_CALL_EXAMPLE.changedQuestion }]);
  assert.deepEqual(changed.outputs, [FIRST_CALL_EXAMPLE.changedAnswer]);

  const hidden = await run(starter.replace('lab.output(response.text);', ''));
  assert.equal(hidden.requests.length, 1);
  assert.deepEqual(hidden.logs, [baseline.response]);
  assert.deepEqual(hidden.outputs, []);

  const film = getChapterFilm('first-call')!;
  assert.equal(film.version, 1, 'Original stable scene IDs retain previous reading history');
  assert.deepEqual(film.frames.map(frame => frame.id), ['input', 'request', 'response', 'display', 'hide-output', 'change-question']);
  assert.match(film.frames.at(-1)!.evidence.map(item => item.value).join(' '), /Agent/);
  assert.match(film.note, /可复现规则/);
});

test('context comparison clears both history messages while preserving system and question', async () => {
  const starter = getLesson('context')!.starter.javascript;
  const requests: ModelRequest[] = [];
  const run = async (code: string) => executeJavascript(code, 'javascript', {
    model: async request => { requests.push(request); return simulateModel(request); },
    step() {}, log() {}, output() {}, tool: async () => { throw new Error('No tool expected'); },
  });
  await run(starter);
  await run(starter.replace(/const history = \[[\s\S]*?\];/, 'const history = [];'));
  assert.equal(requests[0].history!.length, 2);
  assert.equal(requests[1].history!.length, 0);
  assert.equal(requests[0].prompt, requests[1].prompt);
  assert.equal(requests[0].system, requests[1].system);
  assert.equal(simulateModel(requests[1]).text, FIRST_CALL_EXAMPLE.answer);
  assert.equal(getChapterFilm('context')!.frames.find(frame => frame.id === 'remove')!.values.n0, 'history: []');
});

test('temperature changes the fixed random point selection with normalized probabilities', () => {
  const cold = softmaxForFilm([2, 1, 0], .2);
  const warm = softmaxForFilm([2, 1, 0], .7);
  assert.ok(Math.abs(cold.reduce((a, b) => a + b, 0) - 1) < 1e-12);
  assert.ok(cold[0] > warm[0]);
  assert.equal(pickFilmToken(cold, .8), 0);
  assert.equal(pickFilmToken(warm, .8), 1);
  assert.equal(pickFilmToken([.5, .5], .5), 1);
  assert.equal(pickFilmToken([0, 1], 0), 1);
  assert.throws(() => softmaxForFilm([1], 0));
  assert.throws(() => softmaxForFilm([NaN]));
  assert.throws(() => pickFilmToken([.2, .2], .2));
  assert.throws(() => pickFilmToken([1], 1));
  assert.deepEqual(softmaxForFilm([10002, 10001, 10000], .2), cold);
});

test('attention weighted sum agrees with the displayed teaching vectors', () => {
  const film = getChapterFilm('transformer')!;
  const baseline = film.frames[2].visual;
  const final = film.frames.at(-1)!.visual;
  assert.ok(baseline?.kind === 'attention' && final?.kind === 'attention');
  assert.equal((baseline.weights[0] * 10).toFixed(3), '8.044');
  assert.equal((baseline.weights[1] * 20).toFixed(3), '3.911');
  assert.equal((final.weights[0] * 10).toFixed(3), '1.956');
  assert.equal((final.weights[1] * 20).toFixed(3), '16.089');
});

test('training shows one actual gradient update and the corresponding new loss', () => {
  const film = getChapterFilm('training')!;
  const before = film.frames[0].visual;
  const after = film.frames[2].visual;
  const overshoot = film.frames.at(-1)!.visual;
  assert.ok(before?.kind === 'training' && after?.kind === 'training');
  assert.ok(overshoot?.kind === 'training');
  const gradient = 5 * (before.weight - 2);
  assert.equal(gradient, -10);
  assert.equal(after.weight, before.weight - .1 * gradient);
  assert.deepEqual(after.predictions, [after.weight, after.weight * 2]);
  assert.equal(after.loss, 2.5 * (after.weight - 2) ** 2);
  assert.ok(after.loss < before.loss);
  assert.equal(overshoot.loss, 90);
  assert.ok(overshoot.loss > before.loss);
});

test('resuming never indexes outside the selected chapter', () => {
  assert.equal(clampFilmFrame(undefined, 4), 0);
  assert.equal(clampFilmFrame(NaN, 4), 0);
  assert.equal(clampFilmFrame(Infinity, 4), 0);
  assert.equal(clampFilmFrame(-5, 4), 0);
  assert.equal(clampFilmFrame(99, 4), 3);
  assert.equal(clampFilmFrame(2.8, 4), 2);
});

test('later mechanisms do not masquerade as the same generic diagram', () => {
  const mechanisms = new Set(CHAPTER_FILMS.flatMap(film => film.frames.map(frame => frame.visual?.kind ?? 'flow')));
  assert.deepEqual(mechanisms, new Set(['flow', 'tokens', 'vectors', 'evaluation', 'attention', 'training']));
  const evaluation = getChapterFilm('evaluation')!.frames.at(-1)!.visual;
  assert.ok(evaluation?.kind === 'evaluation');
  assert.equal(evaluation.results.filter(result => result === 'pass').length, 3);
  assert.deepEqual(evaluation.results, ['pass', 'pass', 'pass']);
  assert.match(getChapterFilm('agent-loop')!.frames.at(-1)!.cause, /不能声称/);
});

test('numeric film baselines and changes agree with executing the real chapter starters', async () => {
  const baseTokens = await runStarter<{ probabilities: number[]; selected: string }>('tokens');
  const changedTokens = await runStarter<{ probabilities: number[]; selected: string }>('tokens', 'const temperature = 0.7', 'const temperature = 0.2');
  for (const [frameIndex, result] of [[2, baseTokens], [3, changedTokens]] as const) {
    const visual = getChapterFilm('tokens')!.frames[frameIndex].visual;
    assert.ok(visual?.kind === 'tokens');
    assert.deepEqual(visual.probabilities, result.probabilities);
    assert.equal(visual.tokens[visual.picked!], result.selected);
  }
  const attention = await runStarter<{ weights: number[]; mixed: number[] }>('transformer');
  const attentionVisual = getChapterFilm('transformer')!.frames[2].visual;
  assert.ok(attentionVisual?.kind === 'attention');
  assert.deepEqual(attentionVisual.weights, attention.weights);
  const trained = await runStarter<{ nextWeight: number; lossAfter: number }>('training');
  const overshot = await runStarter<{ nextWeight: number; lossAfter: number }>('training', 'const learningRate = 0.1', 'const learningRate = 0.8');
  for (const [index, result] of [[2, trained], [3, overshot]] as const) {
    const visual = getChapterFilm('training')!.frames[index].visual;
    assert.ok(visual?.kind === 'training');
    assert.equal(visual.weight, result.nextWeight);
    assert.equal(visual.loss, result.lossAfter);
  }
  const ranking = await runStarter<{ ranking: { id: string; score: number }[] }>('embeddings');
  const vectorVisual = getChapterFilm('embeddings')!.frames[2].visual;
  assert.ok(vectorVisual?.kind === 'vectors');
  for (const [index, id] of ['rag', 'calculator', 'mixed'].entries()) assert.ok(Math.abs(vectorVisual.scores[index] - ranking.ranking.find(row => row.id === id)!.score) < 1e-12);
  const evaluated = await runStarter<{ passed: number; total: number; scored: { actual: number }[] }>('evaluation');
  const evaluationVisual = getChapterFilm('evaluation')!.frames[2].visual;
  assert.ok(evaluationVisual?.kind === 'evaluation');
  assert.deepEqual(evaluationVisual.actual, evaluated.scored.map(row => row.actual));
  assert.equal(evaluationVisual.results.filter(value => value === 'pass').length, evaluated.passed);
  assert.equal(evaluationVisual.results.length, evaluated.total);
});

test('flow films use the same evidence and contrasting outcomes as the real advanced starters', async () => {
  const rag = await runStarter<{ citations: string[] }>('rag', "const question = '记忆'", "const question = '工具'");
  assert.deepEqual(rag.citations, ['d2']);
  assert.equal(getChapterFilm('rag')!.frames.at(-1)!.values.n3, 'citations:[d2]');
  const memory = await runStarter<{ balance: number }>('memory');
  const duplicate = await runStarter<{ balance: number }>('memory', 'const preserveCompletedIds = true', 'const preserveCompletedIds = false');
  assert.equal(memory.balance, 46); assert.equal(duplicate.balance, 69);
  assert.match(getChapterFilm('memory')!.frames.at(-1)!.values.n3, /69$/);
  const mcp = await runStarter<{ executions: number }>('mcp', 'const allowCall = true', 'const allowCall = false');
  assert.equal(mcp.executions, 0);
  assert.match(getChapterFilm('mcp')!.frames.at(-1)!.values.n3, /执行0次/);
  const collaboration = await runStarter<{ status: string }>('multi-agent', 'const includeSources = true', 'const includeSources = false');
  assert.equal(getChapterFilm('multi-agent')!.frames.at(-1)!.values.n3, collaboration.status);
  const report = await runStarter<{ total: number; budget: number; approved: boolean }>('capstone', 'const people = 17', 'const people = 19');
  assert.deepEqual([report.total, report.budget, report.approved], [437, 420, false]);
  assert.equal(getChapterFilm('capstone')!.frames.at(-1)!.values.n3, 'approved:false');
});
