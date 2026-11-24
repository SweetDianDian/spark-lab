import test from 'node:test';
import assert from 'node:assert/strict';
import type { RunEvent } from '../src/types';
import { describeInputChange } from '../src/lib/practice-comparison';
import { locateTeachingAnchor } from '../src/lib/execution-inspector';

const input = (data: unknown): RunEvent[] => [{ id:'input',seq:1,timestamp:1,type:'step',nodeId:'input',title:'输入',source:'runtime',data }];
test('input comparison uses recorded changes, including empty history and missing evidence', () => {
  assert.equal(describeInputChange(input({temperature:.7, draw:.8}), input({temperature:.2, draw:.8})), 'temperature：0.7 → 0.2');
  assert.equal(describeInputChange(input({history:[1,2]}), input({history:[]})), 'history 从 2 项变为 0 项');
  assert.equal(describeInputChange(input({price:23}), input({price:23})), '两次记录的输入字段相同');
  assert.equal(describeInputChange([], input({price:23})), undefined);
});
test('a source cue skips quoted or commented examples and ambiguous or removed lines', () => {
  const js = "// const question =\nconst label = 'const question =';\nconst question = 'Agent';";
  assert.equal(locateTeachingAnchor(js,'javascript','const question =')?.startLine,3);
  assert.equal(locateTeachingAnchor(js + "\nconst question = 'two';",'javascript','const question ='),null);
  assert.equal(locateTeachingAnchor('# maxSteps = 3\nmymaxSteps = 9\nmaxSteps = 2', 'python','maxSteps =')?.startLine,3);
  assert.equal(locateTeachingAnchor('print("maxSteps =")','python','maxSteps ='),null);
});

test('every authored source cue opens a real line in each language starter', async () => {
  const { lessons } = await import('../src/data/lessons');
  const { getPracticeGuide } = await import('../src/data/practice-guides');
  for (const lesson of lessons) {
    const guide = getPracticeGuide(lesson.id)!;
    for (const language of ['typescript','javascript','python'] as const) {
      for (const frame of Object.values(guide.frames)) {
        const anchor = frame.anchor?.[language];
        if (anchor) assert.ok(locateTeachingAnchor(lesson.starter[language], language, anchor), lesson.id + '/' + language + ': ' + anchor);
      }
      assert.ok(locateTeachingAnchor(lesson.starter[language], language, guide.editAnchor?.[language]), lesson.id + '/' + language);
    }
  }
});
