import { Alert, Card, Collapse, Space, Tag, Typography } from 'antd';
import type { ExecutionInspection } from '../lib/execution-inspector';
import './step-evidence.css';

type Props = { nodeId: string; inspection: ExecutionInspection };
type ValueRecord = Record<string, unknown>;
const record = (value: unknown): ValueRecord | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ValueRecord : undefined;
const owns = (value: ValueRecord, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);

function shortValue(value: unknown, depth = 0): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return value === '' ? '空字符串' : depth && value.length > 90 ? value.slice(0,90)+'…' : value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Number.isInteger(value)) return String(value);
    const displayed = Math.abs(value) < 0.0001 ? value.toExponential(3) : String(Number(value.toFixed(4)));
    return Math.abs(Number(displayed)-value) > 1e-10*Math.max(Math.abs(value),1e-10) ? '≈'+displayed : displayed;
  }
  if (typeof value === 'boolean') return String(value);
  const bounded = (text: string) => text.length > 320 ? text.slice(0,320)+'…（其余见原始数据）' : text;
  if (Array.isArray(value)) {
    if (!value.length) return '空数组（0 项）';
    if (depth > 3) return `${value.length} 项数据（见原始数据）`;
    const limit = value.every(item => item === null || typeof item !== 'object') ? 6 : 3;
    return bounded('['+value.slice(0,limit).map(item => shortValue(item,depth+1)).join(', ')+(value.length>limit?`, …另 ${value.length-limit} 项`:'')+']');
  }
  const object = record(value);
  if (!object) return String(value);
  const entries = Object.entries(object);
  if (!entries.length) return '空对象';
  if (depth > 3) return `${entries.length} 个字段（见原始数据）`;
  return bounded('{ '+entries.slice(0,4).map(([key,field]) => key+': '+shortValue(field,depth+1)).join(', ')+(entries.length>4?`, …另 ${entries.length-4} 字段`:'')+' }');
}
function rawValue(value: unknown): string {
  if (value === undefined) return 'undefined';
  try { return JSON.stringify(value, null, 2) ?? String(value); } catch { return '原始值无法序列化。'; }
}

function Fields({ value, omit = [] }: { value: ValueRecord; omit?: string[] }) {
  const entries = Object.entries(value).filter(([key]) => !omit.includes(key));
  return entries.length ? <dl className="step-evidence-fields">{entries.map(([key, field]) => <div key={key}><dt>{key}</dt><dd>{shortValue(field)}</dd></div>)}</dl> : <Typography.Text type="secondary">空对象</Typography.Text>;
}

function Arguments({ value }: { value: unknown }) {
  const args = record(value);
  if (!args) return <Typography.Paragraph className="step-evidence-copy">{shortValue(value)}</Typography.Paragraph>;
  return <div className="step-evidence-stack">
    {owns(args, 'expression') && <Typography.Text className="step-evidence-formula">{shortValue(args.expression)}</Typography.Text>}
    {owns(args, 'query') && <div><Typography.Text className="step-evidence-label">检索词</Typography.Text><Typography.Paragraph className="step-evidence-query">{shortValue(args.query)}</Typography.Paragraph></div>}
    {Object.keys(args).some(key => !['expression', 'query'].includes(key)) && <Fields value={args} omit={['expression', 'query']}/>}
    {!Object.keys(args).length && <Typography.Text type="secondary">没有参数（空对象）</Typography.Text>}
  </div>;
}

function Request({ value }: { value: ValueRecord }) {
  const hasPrompt = owns(value, 'prompt') || owns(value, 'question');
  const pairedNumbers = owns(value, 'people') && owns(value, 'price');
  const prompt = owns(value, 'prompt') ? value.prompt : value.question;
  const history = Array.isArray(value.history) ? value.history : undefined;
  const displayedKeys = [
    ...(hasPrompt ? [owns(value, 'prompt') ? 'prompt' : 'question'] : []),
    ...(pairedNumbers ? ['people', 'price'] : []),
    ...(value.system !== undefined ? ['system'] : []),
    ...(owns(value, 'maxSteps') ? ['maxSteps'] : []),
    ...(owns(value, 'limit') ? ['limit'] : []),
    ...(history ? ['history'] : []),
    ...(Array.isArray(value.tools) ? ['tools'] : []),
  ];
  return <div className="step-evidence-stack">
    {pairedNumbers && <div><Typography.Text className="step-evidence-label">人数 × 单价</Typography.Text><div className="step-evidence-equation"><strong>{shortValue(value.people)}</strong><span>×</span><strong>{shortValue(value.price)}</strong></div></div>}
    {hasPrompt && <Typography.Paragraph className="step-evidence-copy">{shortValue(prompt)}</Typography.Paragraph>}
    {value.system !== undefined && <div><Typography.Text className="step-evidence-label">规则 system</Typography.Text><Typography.Paragraph className="step-evidence-secondary-copy">{shortValue(value.system)}</Typography.Paragraph></div>}
    <Space size={[4, 5]} wrap>
      {owns(value, 'maxSteps') && <Tag>轮数上限 {shortValue(value.maxSteps)}</Tag>}
      {owns(value, 'limit') && <Tag>上限 limit：{shortValue(value.limit)}</Tag>}
      {history && <Tag>携带 {history.length} 条历史消息</Tag>}
      {Array.isArray(value.tools) && value.tools.map((tool, index) => <Tag key={index}>{shortValue(tool)}</Tag>)}
      {Array.isArray(value.tools) && value.tools.length === 0 && <Tag>未声明工具</Tag>}
    </Space>
    {Object.keys(value).some(key => !displayedKeys.includes(key)) && <Fields value={value} omit={displayedKeys}/>}
  </div>;
}

function ModelResult({ value }: { value: ValueRecord }) {
  const calls = Array.isArray(value.toolCalls) ? value.toolCalls : undefined;
  return <div className="step-evidence-stack">
    {owns(value, 'text') && value.text !== '' && <Typography.Paragraph className="step-evidence-copy">{shortValue(value.text)}</Typography.Paragraph>}
    {calls?.map((call, index) => {
      const request = record(call);
      return <div className="step-evidence-tool-request" key={index}><Space size="small"><Typography.Text className="step-evidence-label">请求工具</Typography.Text><Tag color="blue">{shortValue(request?.name)}</Tag></Space><Arguments value={request && owns(request, 'arguments') ? request.arguments : call}/></div>;
    })}
    {calls?.length === 0 && <Typography.Text className="step-evidence-label">本次没有工具请求</Typography.Text>}
    {value.text === '' && !calls?.length && <Typography.Text type="secondary">返回了空文本</Typography.Text>}
  </div>;
}

function SearchResult({ value }: { value: ValueRecord }) {
  const results = value.results as unknown[];
  const first = record(results[0]);
  return <div className="step-evidence-stack">
    {value.query !== undefined && <Typography.Text className="step-evidence-label">检索：{shortValue(value.query)}</Typography.Text>}
    <Typography.Text strong>{results.length ? `找到 ${results.length} 条资料` : '没有匹配的检索结果'}</Typography.Text>
    {first && <div>{first.title !== undefined && <Typography.Paragraph className="step-evidence-search-title">{shortValue(first.title)}</Typography.Paragraph>}<Typography.Paragraph className="step-evidence-copy">{shortValue(first.text ?? first.content ?? first.summary ?? results[0])}</Typography.Paragraph></div>}
    {!first && results.length > 0 && <Typography.Paragraph className="step-evidence-copy">{shortValue(results[0])}</Typography.Paragraph>}
    {value.source !== undefined && <Typography.Text className="step-evidence-label">{shortValue(value.source)}</Typography.Text>}
  </div>;
}

/** Renders evidence values; it never computes an answer from the expression. */
function ValueSummary({ value }: { value: unknown }) {
  const data = record(value);
  if (data) {
    if (owns(data, 'name') && owns(data, 'arguments')) return <div className="step-evidence-stack"><Tag color="blue">{shortValue(data.name)}</Tag><Arguments value={data.arguments}/></div>;
    if (owns(data, 'name') && owns(data, 'result')) return <div className="step-evidence-stack"><Tag>{shortValue(data.name)}</Tag><ValueSummary value={data.result}/></div>;
    if (typeof data.result === 'number') return <div className="step-evidence-stack">{data.expression !== undefined && <Typography.Text className="step-evidence-label">{shortValue(data.expression)}</Typography.Text>}<Typography.Text className="step-evidence-number">{String(data.result)}</Typography.Text><Typography.Text className="step-evidence-label">实际返回数值</Typography.Text></div>;
    if (Array.isArray(data.results)) return <SearchResult value={data}/>;
    // A local tokenizer input also has `text`; that alone is not a model
    // response. Keep its vocabulary, temperature and other evidence visible.
    if (owns(data, 'toolCalls')) return <ModelResult value={data}/>;
    if (['prompt', 'question', 'people', 'price', 'system', 'history', 'maxSteps', 'limit'].some(key => owns(data, key))) return <Request value={data}/>;
    if (owns(data, 'expression') || owns(data, 'query')) return <Arguments value={data}/>;
    return <Fields value={data}/>;
  }
  if (typeof value === 'number') return <Typography.Text className="step-evidence-number">{String(value)}</Typography.Text>;
  if (Array.isArray(value)) return <div className="step-evidence-stack"><Typography.Text type="secondary">{shortValue(value)}</Typography.Text>{value.slice(0, 3).map((item, index) => <Typography.Paragraph className="step-evidence-copy" key={index}>{shortValue(item)}</Typography.Paragraph>)}{value.length > 3 && <Typography.Text className="step-evidence-label">其余内容见原始数据。</Typography.Text>}</div>;
  return <Typography.Paragraph className="step-evidence-copy">{shortValue(value)}{value === null || value === undefined ? '（实际值）' : ''}</Typography.Paragraph>;
}

export default function StepEvidence({ nodeId, inspection }: Props) {
  const payload = inspection.event?.type === 'step' ? record(inspection.event.data) : undefined;
  const recordedInputNull = !!payload && owns(payload, 'input') || nodeId === 'input' && inspection.event?.type === 'step' && inspection.event.data === null;
  const recordedResultNull = !!payload && owns(payload, 'result') || inspection.event?.type === 'output' || inspection.event?.type === `${nodeId}.completed`;
  const hasInput = inspection.input !== null && inspection.input !== undefined || recordedInputNull;
  const hasResult = inspection.result !== null && inspection.result !== undefined || recordedResultNull;
  const stopped = inspection.state === 'failed' || inspection.state === 'cancelled';
  const errorData = record(inspection.result);
  const failure = errorData?.error ?? (typeof inspection.result === 'string' ? inspection.result : undefined);
  return <div className="step-evidence">
    <div className="step-evidence-values">
      <Card size="small" title={inspection.inputLabel} className="step-evidence-input-card"><div className="step-evidence-summary" data-testid="step-input">{hasInput ? <ValueSummary value={inspection.input}/> : <Typography.Paragraph className="step-evidence-pending">{nodeId === 'output' ? '尚无可匹配的前一步返回值。' : '尚未记录本次输入。'}</Typography.Paragraph>}</div></Card>
      <Card size="small" title={inspection.resultLabel} className="step-evidence-result-card"><div className="step-evidence-summary" data-testid="step-result">{stopped ? <Alert type={inspection.state === 'failed' ? 'error' : 'warning'} showIcon title={inspection.state === 'failed' ? '本次未完成' : '本次已停止'} description={failure !== undefined ? shortValue(failure) : '没有新的返回结果。'}/> : hasResult ? <ValueSummary value={inspection.result}/> : <Typography.Paragraph className="step-evidence-pending">{inspection.state === 'running' ? '正在等待这一次调用返回…' : '本步骤还没有产生结果。'}</Typography.Paragraph>}</div></Card>
    </div>
    {(hasInput || hasResult || stopped) && <Collapse size="small" ghost className="step-evidence-raw" items={[{ key: 'raw', label: '查看原始输入与结果', children: <div className="step-evidence-raw-values"><div><Typography.Text strong>{inspection.inputLabel}</Typography.Text><pre>{rawValue(inspection.input)}</pre></div><div><Typography.Text strong>{inspection.resultLabel}</Typography.Text><pre>{rawValue(inspection.result)}</pre></div></div> }]}/>}
  </div>;
}
