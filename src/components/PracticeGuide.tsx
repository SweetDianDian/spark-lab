import { useId } from 'react';
import { Button, Card, Collapse, Flex, Tooltip, Typography } from 'antd';
import { AimOutlined, DiffOutlined, FileTextOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { getPracticeGuide } from '../data/practice-guides';
import './practice-guide.css';

export type PracticeGuidePhase = 'initial' | 'baseline' | 'edited' | 'compared' | 'retry' | 'replay';
export type PracticeGuideProps = {
  lessonId: string;
  phase: PracticeGuidePhase;
  outputs: { before?: unknown; after?: unknown };
  canLocate: boolean;
  onLocate: () => void;
  onCompare: () => void;
  comparisonAvailable: boolean;
  onRun?: () => void;
  onInspectOutput?: () => void;
  /** Overrides the default-example edit when the learner entered with other inputs. */
  editInstruction?: string;
  /** A change extracted by the parent from two actual input events. */
  inputChange?: string;
};

const fieldLabels: Record<string, string> = {
  answer: '回答', text: '文字', total: '总额', result: '结果', expression: '算式',
  balance: '账本金额', selected: '选中候选', temperature: '温度', bestMatch: '首位资料', query: '查询',
  lossBefore: '更新前损失', lossAfter: '更新后损失', nextWeight: '新参数', successRate: '通过率',
  failures: '未通过案例', approved: '预算核验', budget: '预算', status: '状态', review: '核验结果',
  accepted: '接受交付', issues: '问题', citations: '引用', executedIds: '本次执行', skippedIds: '已跳过',
  executions: '工具执行次数', response: '响应', error: '错误', message: '信息',
};
const preferredFields = Object.keys(fieldLabels);
const outputPrompts: Record<string, string> = {
  'first-call': '运行后，找一找返回的文字有没有显示出来。',
  context: '运行后，看回答如何使用这次请求带入的背景。',
  tools: '运行后，核对实际算式、计算结果与最终输出。',
  'agent-loop': '运行后，先找最终回答或上限提示，再看工具执行顺序。',
  tokens: '运行后，先看候选概率和选中的词。',
  transformer: '运行后，对照两项权重与混合后的向量。',
  training: '运行后，比较更新前后的损失；变大或变小都看实际数值。',
  embeddings: '运行后，先找相似度分数和第一名资料。',
  rag: '运行后，核对引用编号与原文摘录是否对应。',
  memory: '运行后，看账本金额、这次执行了什么、跳过了什么。',
  mcp: '运行后，分别看能力清单、实际执行次数与调用结果。',
  evaluation: '运行后，查看通过率，也别漏掉失败案例。',
  'multi-agent': '运行后，核对交接来源，以及核验者是否接受。',
  capstone: '运行后，核对总额、预算与报告的批准状态。',
};
function shorten(text: string, limit: number) {
  const characters = Array.from(text);
  return characters.length > limit ? characters.slice(0, Math.max(0, limit - 1)).join('') + '…' : text;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function shortNumber(value: number): string {
  if (!Number.isFinite(value) || Number.isInteger(value)) return String(value);
  const rounded = Number(value.toPrecision(4));
  return `${rounded === value ? '' : '≈'}${rounded}`;
}
function shortValue(value: unknown): string {
  if (typeof value === 'number') return shortNumber(value);
  if (Array.isArray(value) && value.every(item => typeof item === 'number')) {
    return `[${value.slice(0, 6).map(shortNumber).join(', ')}${value.length > 6 ? ', …' : ''}]`;
  }
  return outputPreview(value, 0, new Set());
}
function chapterPreview(value: unknown, lessonId?: string): string | undefined {
  if (!isRecord(value)) return;
  const entries: string[] = [];
  const field = (key: string, label: string, source = value) => {
    if (source[key] !== undefined) entries.push(`${label}：${shortValue(source[key])}`);
  };
  switch (lessonId) {
    case 'tokens': field('probabilities', '候选概率'); field('selected', '选中'); break;
    case 'transformer': field('weights', '来源权重'); field('mixed', '混合向量'); break;
    case 'training': field('lossBefore', '更新前损失'); field('lossAfter', '更新后损失'); field('nextWeight', '新参数'); break;
    case 'embeddings':
      field('bestMatch', '第一名');
      if (Array.isArray(value.ranking)) {
        const scores = value.ranking.slice(0, 3).filter(isRecord).filter(item => typeof item.id === 'string' && typeof item.score === 'number');
        if (scores.length) entries.push('相似度：' + scores.map(item => `${item.id} ${shortNumber(item.score as number)}`).join(' / '));
      }
      break;
    case 'rag': field('citations', '引用'); field('answer', '证据摘录'); break;
    case 'memory': field('balance', '账本金额'); field('executedIds', '本次执行'); field('skippedIds', '已跳过'); break;
    case 'mcp':
      field('executions', '执行次数');
      if (isRecord(value.response)) {
        if (isRecord(value.response.error)) field('message', '调用错误', value.response.error);
        else if (isRecord(value.response.result)) {
          const content = value.response.result.content;
          if (Array.isArray(content)) {
            const text = content.filter(isRecord).filter(item => typeof item.text === 'string').map(item => item.text).join(' ');
            if (text) entries.push('工具返回：' + shorten(text, 90));
          }
        }
      }
      break;
    case 'evaluation':
      if (typeof value.passed === 'number' && typeof value.total === 'number') entries.push(`通过案例：${value.passed}/${value.total}`);
      field('failures', '失败列表'); break;
    case 'multi-agent':
      if (isRecord(value.review)) { field('accepted', '验收通过', value.review); field('issues', '问题', value.review); field('sourceIds', '来源', value.review); }
      break;
    case 'capstone': field('total', '总额'); field('budget', '预算'); field('approved', '预算核验'); break;
    case 'tools': field('expression', '实际算式'); field('result', '计算结果'); break;
  }
  return entries.length ? entries.join('；') : undefined;
}
function outputPreview(value: unknown, depth: number, ancestors: Set<object>): string {
  if (value === undefined) return '未产生最终输出';
  if (value === null) return 'null（空值）';
  if (typeof value === 'string') return value.length ? shorten(value.replace(/\s+/g, ' ').trim() || '空白字符串', 140) : '空字符串';
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (typeof value !== 'object') return String(value);
  if (ancestors.has(value)) return '循环引用';
  if (value instanceof Error) return value.message || value.name;
  if (depth > 2) return Array.isArray(value) ? `${value.length} 项数据` : '嵌套对象';
  const next = new Set(ancestors).add(value);
  if (Array.isArray(value)) {
    if (!value.length) return '空数组 []';
    return value.slice(0, 3).map(item => outputPreview(item, depth + 1, next)).join('、') + (value.length > 3 ? `…（共 ${value.length} 项）` : '');
  }
  const keys = Object.keys(value);
  if (!keys.length) return '空对象 {}';
  const prioritized = preferredFields.filter(key => keys.includes(key));
  const shown = [...prioritized, ...keys.filter(key => !prioritized.includes(key))].slice(0, 3);
  return shown.map(key => `${fieldLabels[key] ?? key}：${outputPreview((value as Record<string, unknown>)[key], depth + 1, next)}`).join('；') + (keys.length > shown.length ? '…' : '');
}

/** A bounded preview only; never substitutes an expected value for actual output. */
export function summarizePracticeOutput(value: unknown, limit = 180, lessonId?: string): string {
  try { return shorten(chapterPreview(value, lessonId) ?? outputPreview(value, 0, new Set()), limit); }
  catch { return '这份输出无法生成摘要，请查看原始运行证据。'; }
}

function rawOutput(value: unknown): string {
  if (value === undefined) return '未产生最终输出';
  if (typeof value === 'string') return value;
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(value, (_key, item: unknown) => {
      if (typeof item === 'bigint') return `${item}n`;
      if (typeof item === 'undefined') return '[undefined]';
      if (typeof item === 'function' || typeof item === 'symbol') return String(item);
      if (item && typeof item === 'object') {
        if (seen.has(item)) return '[重复或循环引用]';
        seen.add(item);
        if (item instanceof Error) return { name: item.name, message: item.message, stack: item.stack };
      }
      return item;
    }, 2) ?? String(value);
  } catch { return '这份输出无法序列化，请查看执行记录。'; }
}

type OutputItem = { key: 'before' | 'after'; label: string; value: unknown };
function RawOutputs({ items }: { items: OutputItem[] }) {
  return <div className="practice-guide-raw">{items.map(item => <div key={item.key}><Typography.Text strong>{item.label}</Typography.Text><pre>{rawOutput(item.value)}</pre></div>)}</div>;
}

const phaseTitles: Record<PracticeGuidePhase, string> = {
  initial: '先跑一次，看看代码做了什么',
  baseline: '结果已记录，接着只改一处',
  edited: '代码改过了，再运行才有新结果',
  compared: '现在对照两次实际输出',
  retry: '先修正这次运行，再开始对照',
  replay: '正在查看只读历史记录',
};

export default function PracticeGuide({ lessonId, phase, outputs, canLocate, onLocate, onCompare, comparisonAvailable, onRun, onInspectOutput, editInstruction, inputChange }: PracticeGuideProps) {
  const titleId = useId();
  const guide = getPracticeGuide(lessonId);
  const edit = editInstruction ?? guide?.edit ?? '只改变一个输入值，其他代码、语言和模式保持一致。';
  const observe = guide?.observe ?? '核对实际输入与最终输出，沿执行步骤检查差异来自哪里。';
  const canEdit = phase === 'baseline' || phase === 'edited' || phase === 'compared';
  const canRun = !!onRun && phase !== 'replay';
  const canCompare = comparisonAvailable && phase !== 'replay' && phase !== 'initial';
  const items: OutputItem[] = [];
  if (phase !== 'initial' && phase !== 'retry') {
    if (outputs.before !== undefined) items.push({ key: 'before', value: outputs.before, label: phase === 'replay' ? '当前回放位置的输出' : phase === 'edited' ? '修改前的实际输出' : phase === 'compared' ? '上一次实际输出' : '最近一次实际输出' });
    if (phase === 'compared' && outputs.after !== undefined) items.push({ key: 'after', value: outputs.after, label: '本次实际输出' });
  }
  const inspectLabel = phase === 'retry' ? '查看错误与运行记录' : '查看完整运行证据';
  const showRun = canRun && (phase === 'initial' || phase === 'edited' || phase === 'retry');
  const showInspect = !!onInspectOutput && phase !== 'initial' && (items.length > 0 || phase === 'retry');

  return <Card className={`practice-guide practice-guide-${phase}`} size="small" aria-labelledby={titleId} data-phase={phase}>
    <Typography.Title level={5} id={titleId} className="practice-guide-title">{phaseTitles[phase]}</Typography.Title>
    {phase === 'initial' && <>
      <Typography.Paragraph className="practice-guide-goal">{outputPrompts[lessonId] ?? '运行后，先找到这次代码实际产生的输出。'}</Typography.Paragraph>
      <Typography.Paragraph className="practice-guide-instruction">先运行当前代码，留下第一份实际结果。之后再只改一个值。</Typography.Paragraph>
    </>}
    {phase === 'edited' && <Typography.Paragraph className="practice-guide-instruction">下面保留的是旧记录，还不能说明当前代码的结果。保持同一语言与模式，再运行一次。</Typography.Paragraph>}
    {phase === 'retry' && <Typography.Paragraph className="practice-guide-instruction">这次失败、停止或缺少必要输出，尚未形成有效对照。先检查执行记录，修正后再运行。</Typography.Paragraph>}
    {phase === 'replay' && <Typography.Paragraph className="practice-guide-instruction">回放不会重新运行。这里只显示已经播放到的位置；继续编辑并实际运行后，才能建立新对照。</Typography.Paragraph>}
    {phase === 'compared' && inputChange?.trim() && <div className="practice-guide-input-change"><Typography.Text strong>本次输入变化</Typography.Text><Typography.Paragraph>{inputChange}</Typography.Paragraph></div>}
    {items.length > 0 && <div className={`practice-guide-outputs${items.length === 2 ? ' has-pair' : ''}`} aria-label="来自实际 lab.output 的摘要">{items.map(item => <div className="practice-guide-output" key={item.key}><Typography.Text className="practice-guide-source">{item.label} · lab.output 摘要</Typography.Text><Typography.Paragraph ellipsis={{ rows: 3 }}>{summarizePracticeOutput(item.value, 180, lessonId)}</Typography.Paragraph></div>)}</div>}
    {phase === 'replay' && !items.length && <Typography.Paragraph className="practice-guide-pending">当前回放位置还没有最终输出。</Typography.Paragraph>}
    {phase === 'baseline' && <div className="practice-guide-task"><Typography.Text strong>{editInstruction ? '只改这一处' : '默认示例的改法'}</Typography.Text><Typography.Paragraph>{edit}</Typography.Paragraph></div>}
    {(phase === 'baseline' || phase === 'compared') && <div className="practice-guide-observe"><Typography.Text strong>示例预期</Typography.Text><Typography.Paragraph ellipsis={{ rows: 2, expandable: 'collapsible', symbol: expanded => expanded ? '收起' : '展开' }}>{observe}</Typography.Paragraph></div>}
    {(showRun || canEdit || canCompare || showInspect) && <Flex className="practice-guide-actions" wrap gap={8}>
      {showRun && <Button type="primary" size="small" icon={<PlayCircleOutlined/>} onClick={onRun}>{phase === 'initial' ? '运行当前代码' : phase === 'edited' ? '运行修改后的代码' : '重新运行'}</Button>}
      {canEdit && <Tooltip title={canLocate ? undefined : '没有找到对应位置，可按变量名在编辑器中查找。'}><Button size="small" type={phase === 'baseline' ? 'primary' : 'default'} icon={<AimOutlined/>} onClick={onLocate} disabled={!canLocate}>定位要改的代码</Button></Tooltip>}
      {canCompare && <Button size="small" type={phase === 'compared' ? 'primary' : 'default'} icon={<DiffOutlined/>} onClick={onCompare}>对比两次运行</Button>}
      {showInspect && <Button size="small" type="text" icon={<FileTextOutlined/>} onClick={onInspectOutput}>{inspectLabel}</Button>}
    </Flex>}
    {!onInspectOutput && items.length > 0 && <Collapse className="practice-guide-raw-entry" ghost size="small" items={[{ key: 'raw', label: '查看完整输出', children: <RawOutputs items={items}/> }]}/>}
  </Card>;
}
