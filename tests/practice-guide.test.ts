import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ComponentType } from 'react';
import type { PracticeGuideProps } from '../src/components/PracticeGuide';

// Bundle the component's local data and omit CSS for a genuine server render.
// React and Ant Design remain the real installed components, not test doubles.
const bundle = buildSync({ entryPoints: [fileURLToPath(new URL('../src/components/PracticeGuide.tsx', import.meta.url))], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external', loader: { '.css': 'empty' }, jsx: 'automatic' });
const module = { exports: {} as { default: ComponentType<PracticeGuideProps>; summarizePracticeOutput: (value: unknown, limit?: number, lessonId?: string) => string } };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { default: PracticeGuide, summarizePracticeOutput } = module.exports;
const noop = () => {};
function render(overrides: Partial<PracticeGuideProps>) {
  return renderToStaticMarkup(createElement(PracticeGuide, { lessonId: 'tools', phase: 'initial', outputs: {}, canLocate: true, onLocate: noop, onCompare: noop, comparisonAvailable: false, ...overrides }));
}

test('actual output previews retain zero, false, null and bounded nested values', () => {
  assert.equal(summarizePracticeOutput(0), '0');
  assert.equal(summarizePracticeOutput(false), 'false');
  assert.equal(summarizePracticeOutput(null), 'null（空值）');
  assert.match(summarizePracticeOutput({ total: 0, approved: false }), /总额：0；预算核验：false/);
  assert.ok(Array.from(summarizePracticeOutput('字'.repeat(1000))).length <= 180);
  const cyclic: Record<string, unknown> = { result: 0 }; cyclic.self = cyclic;
  assert.match(summarizePracticeOutput(cyclic), /循环引用/);
  assert.doesNotThrow(() => summarizePracticeOutput({ amount: 10n }));
});

test('each numeric experiment retains its causal quantities instead of generic first fields', () => {
  const tokens = summarizePracticeOutput({ pieces: ['AI', '学习'], temperature: 0.7, probabilities: [0.7709602966611171, 0.18476143415029564, 0.04427826918858726], selected: '结束' }, 180, 'tokens');
  assert.match(tokens, /候选概率：\[≈0\.771, ≈0\.1848, ≈0\.04428\]/);
  assert.match(tokens, /选中：结束/);
  assert.doesNotMatch(tokens, /pieces/);
  assert.match(summarizePracticeOutput({ scores: [1, -1], weights: [0.8, 0.2], mixed: [8, 4] }, 180, 'transformer'), /来源权重：\[0\.8, 0\.2\]；混合向量：\[8, 4\]/);
  assert.match(summarizePracticeOutput({ weight: 0, nextWeight: 8, lossBefore: 10, lossAfter: 90, improved: false }, 180, 'training'), /^更新前损失：10；更新后损失：90/);
  assert.match(summarizePracticeOutput({ query: '自定义', bestMatch: 'custom', ranking: [{ id: 'custom', score: 0.123456 }, { id: 'other', score: 0 }] }, 180, 'embeddings'), /第一名：custom；相似度：custom ≈0\.1235 \/ other 0/);
});

test('initial guidance reveals no empty or supplied output cards before a real baseline', () => {
  const html = render({ onRun: noop, outputs: { before: 391, after: 437 } });
  assert.match(html, /运行当前代码/);
  assert.doesNotMatch(html, /lab\.output 摘要|查看完整输出|定位要改的代码|对比两次运行/);
});

test('baseline exposes the editable condition and separates example expectations from actual output', () => {
  const html = render({ phase: 'baseline', outputs: { before: 0 }, editInstruction: '这次只把 people 从 19 改回 17。' });
  assert.match(html, /最近一次实际输出/);
  assert.match(html, />0</);
  assert.match(html, /这次只把 people 从 19 改回 17。/);
  assert.match(html, /示例预期/);
  assert.match(html, /定位要改的代码/);
  assert.match(html, /查看完整输出/);
  assert.doesNotMatch(html, /对比两次运行/);
});

test('edited code labels old evidence and cannot expose an unexecuted after value', () => {
  const html = render({ phase: 'edited', outputs: { before: 12345, after: 98765 }, onRun: noop, canLocate: false });
  assert.match(html, /修改前的实际输出/);
  assert.match(html, /12345/);
  assert.doesNotMatch(html, /98765/);
  assert.match(html, /还不能说明当前代码的结果/);
  assert.match(html, /运行修改后的代码/);
  assert.doesNotMatch(render({ phase: 'edited', outputs: { before: 1 } }), /运行修改后的代码/);
});

test('comparison shows actual input change and two outputs, only exposing comparison when available', () => {
  const values = { phase: 'compared' as const, outputs: { before: false, after: true }, inputChange: 'temperature：0.7 → 0.2' };
  const html = render({ ...values, comparisonAvailable: true, onInspectOutput: noop });
  assert.match(html, /本次输入变化/);
  assert.match(html, /temperature：0.7 → 0.2/);
  assert.match(html, /上一次实际输出/);
  assert.match(html, /本次实际输出/);
  assert.match(html, />false</);
  assert.match(html, />true</);
  assert.match(html, /对比两次运行/);
  assert.match(html, /查看完整运行证据/);
  assert.doesNotMatch(render(values), /对比两次运行/);
});

test('replays remain read-only even when active callbacks were supplied', () => {
  const html = render({ phase: 'replay', outputs: { before: '历史样本' }, onRun: noop, onInspectOutput: noop, comparisonAvailable: true });
  assert.match(html, /当前回放位置的输出/);
  assert.match(html, /历史样本/);
  assert.doesNotMatch(html, /定位要改的代码|对比两次运行|运行当前代码|运行修改后的代码/);
  assert.match(render({ phase: 'replay' }), /当前回放位置还没有最终输出/);
});

test('failed or stopped attempts do not advertise partial output as a successful baseline', () => {
  const html = render({ phase: 'retry', outputs: { before: '不完整样本' }, onRun: noop, onInspectOutput: noop });
  assert.match(html, /尚未形成有效对照/);
  assert.match(html, /查看错误与运行记录/);
  assert.match(html, /重新运行/);
  assert.doesNotMatch(html, /不完整样本|lab\.output 摘要/);
});
