import test from 'node:test';
import assert from 'node:assert/strict';
import { getCourseRoutes } from '../src/data/course-routes';
import { getLearningSections, LEARNING_PATH } from '../src/data/learning-path';

test('the complete curriculum becomes seven short routes in the original catalogue order', () => {
  const routes = getCourseRoutes();
  assert.deepEqual(routes.map(row => row.steps.map(step => step.lessonId)), [
    ['first-call', 'context', 'tools', 'agent-loop'],
    ['tokens', 'transformer', 'training'],
    ['embeddings', 'rag'],
    ['memory'],
    ['mcp'],
    ['evaluation', 'multi-agent'],
    ['capstone'],
  ]);
  const mainNodes = routes.flatMap(row => row.steps.map(step => step.lessonId));
  assert.deepEqual(mainNodes, LEARNING_PATH.map(item => item.lessonId));
  assert.equal(new Set(mainNodes).size, mainNodes.length, 'every chapter appears as one primary node');
  assert.equal(new Set(routes.map(row => row.id)).size, routes.length);
  assert.deepEqual(routes.map(row => row.title), ['调用与执行', '模型原理', '资料检索', '状态恢复', '工具接入', '评测与协作', '综合项目']);
});

test('horizontal links plus extra prerequisites reproduce every real dependency exactly once', () => {
  const sections = getLearningSections();
  for (const row of getCourseRoutes()) {
    const section = sections.find(item => item.id === row.sectionId)!;
    assert.ok(section);
    assert.equal(row.id, row.steps[0].lessonId);
    for (const [index, step] of row.steps.entries()) {
      assert.ok(section.lessons.some(item => item.lessonId === step.lessonId), 'rows cannot cross section boundaries');
      const original = LEARNING_PATH.find(item => item.lessonId === step.lessonId)!;
      const previous = row.steps[index - 1]?.lessonId;
      if (previous) {
        assert.ok(original.prerequisites.includes(previous), 'catalogue adjacency alone must never become an arrow');
        assert.ok(!step.extraPrerequisites.includes(previous), 'the horizontal predecessor should not be repeated');
      }
      const represented = [...step.extraPrerequisites, ...(previous ? [previous] : [])];
      assert.deepEqual(represented.sort(), [...original.prerequisites].sort(), step.lessonId);
    }
  }
  const steps = new Map(getCourseRoutes().flatMap(row => row.steps.map(step => [step.lessonId, step] as const)));
  assert.deepEqual(steps.get('rag')!.extraPrerequisites, ['context']);
  assert.deepEqual(steps.get('memory')!.extraPrerequisites, ['context', 'agent-loop']);
  assert.deepEqual(steps.get('multi-agent')!.extraPrerequisites, ['agent-loop']);
  assert.deepEqual(steps.get('capstone')!.extraPrerequisites, ['rag', 'tools', 'evaluation']);
});

test('new chapters and branches adapt without a hand-maintained route registry or invented adjacency', () => {
  const sections = [
    { id: 'one', lessons: [
      { lessonId: 'start', title: '新起点', prerequisites: [] },
      { lessonId: 'dependent', title: '直接后继', prerequisites: ['start', 'elsewhere'] },
      { lessonId: 'branch', title: '新的独立分支', prerequisites: ['start'] },
      { lessonId: 'branch-next', title: '分支后继', prerequisites: ['branch', 'dependent'] },
      { lessonId: 'unrelated', title: '没有先修的新章', prerequisites: [] },
    ] },
    { id: 'two', lessons: [{ lessonId: 'next-section', title: '新分段', prerequisites: ['unrelated'] }] },
    { id: 'empty', lessons: [] },
  ];
  const original = structuredClone(sections);
  const rows = getCourseRoutes(sections);
  assert.deepEqual(rows.map(row => row.steps.map(step => step.lessonId)), [
    ['start', 'dependent'], ['branch', 'branch-next'], ['unrelated'], ['next-section'],
  ]);
  assert.deepEqual(rows.map(row => row.title), ['新起点', '新的独立分支', '没有先修的新章', '新分段']);
  assert.deepEqual(rows[0].steps[1].extraPrerequisites, ['elsewhere']);
  assert.deepEqual(rows[1].steps[0].extraPrerequisites, ['start']);
  assert.deepEqual(rows[1].steps[1].extraPrerequisites, ['dependent']);
  assert.deepEqual(rows[3].steps[0].extraPrerequisites, ['unrelated'], 'a new section never connects across rows');
  assert.deepEqual(sections, original, 'deriving routes cannot mutate curriculum metadata');
  assert.deepEqual(getCourseRoutes([]), []);
});
