import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, InputNumber, Modal, Segmented, Space, Steps, Tag, Typography } from 'antd';
import { ApiOutlined, CalculatorOutlined, CodeOutlined, FileTextOutlined, PauseCircleOutlined, PlayCircleOutlined, ReloadOutlined, StopOutlined, TeamOutlined } from '@ant-design/icons';
import { getStoryStarter } from '../lib/tool-story';
import type { RunEvent, RunResult } from '../types';
import CourseRail from './CourseRail';
import './landing.css';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function evidenceText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return '尚未捕获';
  return JSON.stringify(value, null, 2);
}
function lastEvent(events: RunEvent[], type: string): RunEvent | undefined {
  return [...events].reverse().find(event => event.type === type);
}

export default function Landing() {
  const navigate = useNavigate();
  const [pane, setPane] = useState<'experiment' | 'courses'>('experiment');
  const [people, setPeople] = useState(17);
  const [runPeople, setRunPeople] = useState<number | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [result, setResult] = useState<RunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [replaying, setReplaying] = useState(false);
  const [replayCount, setReplayCount] = useState(0);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const generation = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current++; controller.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!replaying) return;
    if (replayCount >= events.length) { setReplaying(false); return; }
    const timer = window.setTimeout(() => setReplayCount(count => count + 1), 430);
    return () => window.clearTimeout(timer);
  }, [replaying, replayCount, events.length]);

  const visibleEvents = replaying ? events.slice(0, replayCount) : events;
  const inputEvent = visibleEvents.find(event => event.type === 'step' && event.nodeId === 'input');
  const modelStarted = lastEvent(visibleEvents, 'model.started');
  const modelEvent = lastEvent(visibleEvents, 'model.completed');
  const toolStarted = lastEvent(visibleEvents, 'tool.started');
  const toolEvent = lastEvent(visibleEvents, 'tool.completed');
  const outputEvent = lastEvent(visibleEvents, 'output');
  const input = asRecord(inputEvent?.data);
  const modelResponse = asRecord(modelEvent?.data);
  const calls = Array.isArray(modelResponse?.toolCalls) ? modelResponse.toolCalls : [];
  const call = asRecord(calls.find(value => asRecord(value)?.name === 'calculator') ?? calls[0]);
  const requestedArguments = asRecord(call?.arguments);
  const actualTool = asRecord(toolEvent?.data);
  const toolResult = asRecord(actualTool?.result);
  const toolInput = asRecord(toolStarted?.data);
  const output = outputEvent?.data;
  const outputValue = typeof output === 'number' ? output : asRecord(output)?.result;
  const amount = typeof outputValue === 'number' && Number.isFinite(outputValue) ? outputValue : null;
  const consistent = amount !== null && amount === toolResult?.result;
  const stale = runPeople !== null && people !== runPeople;
  const activeStation = outputEvent ? 3 : toolStarted ? 2 : modelStarted ? 1 : inputEvent ? 0 : -1;
  const stationEvents = [inputEvent, modelEvent, toolEvent, outputEvent];
  const showMotion = running || replaying;

  function changePeople(value: number | null) {
    if (value === null || !Number.isFinite(value)) return;
    setPeople(Math.min(99, Math.max(1, Math.round(value))));
    setReplaying(false);
  }
  function replay() {
    if (running || !events.length) return;
    if (replaying) { setReplaying(false); return; }
    setReplayCount(0); setReplaying(true);
  }
  async function runStory() {
    if (controller.current) return;
    const ticket = ++generation.current;
    const abort = new AbortController();
    controller.current = abort;
    setRunPeople(people); setRunning(true); setReplaying(false); setResult(null); setEvents([]); setError('');
    try {
      const { runCode } = await import('../runtime');
      if (!mounted.current || ticket !== generation.current) return;
      const run = await runCode({
        code: getStoryStarter('javascript', people), language: 'javascript', mode: 'demo', lessonId: 'tools', signal: abort.signal,
        onEvent: event => { if (mounted.current && ticket === generation.current) setEvents(value => [...value, event]); },
      });
      if (!mounted.current || ticket !== generation.current) return;
      setResult(run); setEvents(run.events);
      if (run.status === 'completed') { setReplayCount(0); setReplaying(true); }
      else setError(run.status === 'cancelled' ? '已取消这次执行。已捕获的事件保留，可以重新运行。' : run.error ?? '这次执行未完成，请重试。');
    } catch (cause) {
      if (mounted.current && ticket === generation.current) setError(cause instanceof Error ? cause.message : '暂时无法启动实验，请重试。');
    } finally {
      if (mounted.current && ticket === generation.current) { setRunning(false); controller.current = null; }
    }
  }

  const stationContents = [
    <div className="story-station story-input" key="input">
      <div className="story-ticket-numbers"><span>{inputEvent ? String(input?.people ?? '—') : '—'}<small>人</small></span><i>×</i><span>{inputEvent ? String(input?.price ?? '—') : '—'}<small>元</small></span></div>
      <Typography.Text className="story-station-caption">实际送出的条件</Typography.Text>
    </div>,
    <div className="story-station story-request" key="model">
      <div className="story-command">
        <strong>{call ? String(requestedArguments?.expression ?? '—') : '—'}</strong>
        <code>{call ? `${String(call.name)}(...)` : modelEvent ? String(modelResponse?.text ?? '没有工具请求') : '工具名 + 算式'}</code>
      </div>
    </div>,
    <div className="story-station story-execution" key="tool">
      <div className={`story-calculator ${toolEvent ? 'has-evidence' : ''}`}>
        <CalculatorOutlined aria-hidden="true"/><div><strong>{toolEvent ? evidenceText(toolResult?.result ?? actualTool?.result) : '—'}</strong><code>{toolStarted ? `${evidenceText(asRecord(toolInput?.arguments)?.expression)} 的返回值` : '计算器实际返回'}</code></div>
      </div>
    </div>,
    <div className="story-station story-output" key="output">
      <div className={`story-receipt ${outputEvent ? 'has-evidence' : ''}`}>
        <div className="story-receipt-total">{amount !== null ? <><small>¥</small><strong>{amount}</strong></> : outputEvent ? <span className="story-output-text">{evidenceText(output)}</span> : <strong className="story-output-pending">—</strong>}</div>
        <span className="story-receipt-note">{outputEvent ? `${runPeople} 人 · 本次实际输出` : '实际输出金额'}</span>
      </div>
    </div>,
  ];

  return <section className="landing story-landing" aria-label="实验与课程" data-pane={pane}>
    <div className="story-pane-switch"><Segmented<'experiment' | 'courses'> aria-label="切换实验与课程" value={pane} onChange={setPane} options={[{ value: 'experiment', label: '聚餐实验' }, { value: 'courses', label: '四节课程' }]}/></div>
    <div className="story-workbench">
      <div className="story-mainstage" role="region" aria-label="聚餐费用实验，内容过长可独立滚动" tabIndex={0}>
        <header className="story-header">
          <div className="story-kicker"><span>工具调用</span>从一顿饭开始</div>
          <Typography.Title level={1} id="story-heading">吃完这顿，<br/><em>谁来算账？</em></Typography.Title>
          <Typography.Paragraph className="story-lead">朋友聚餐，每人 23 元。把账单递给 AI，<br/>看看最后是谁按下了计算器。</Typography.Paragraph>
          <div className="story-controls"><label htmlFor="story-people">这桌有</label><InputNumber id="story-people" aria-label="参与人数" aria-describedby="story-input-note" min={1} max={99} precision={0} value={people} onChange={changePeople} disabled={running} suffix="人" size="large"/><Button type="primary" size="large" icon={running ? <StopOutlined/> : error ? <ReloadOutlined/> : <PlayCircleOutlined/>} onClick={() => running ? controller.current?.abort() : void runStory()}>{running ? '停一下' : stale ? '按新人数结账' : error ? '再试一次' : result ? '再算一次' : '把账单交给 AI'}</Button></div>
          <div id="story-input-note" className="story-input-note" aria-live="polite">{stale ? <Typography.Text type="warning">当前 {people} 人还未运行，下方仍是 {runPeople} 人的记录。</Typography.Text> : <Typography.Text>教学模型试跑，计算器现场算。无需密钥。</Typography.Text>}</div>
        </header>
        <figure className="story-illustration">
          <img src="/art/dinner-print.webp" alt="一桌面刚吃完，一位朋友递过长长的账单，另一位伸手去按计算器。" width="930" height="620" fetchPriority="high"/>
          <figcaption className="story-bill"><span>本桌账单</span><strong>{people} 人 × 23 元</strong><small>{amount !== null && !stale ? `实收 ¥${amount}` : '待结账'}</small></figcaption>
        </figure>
      </div>
      <div className="story-flow-stage" role="region" aria-label="四步执行流程，内容过长可独立滚动" tabIndex={0}>
      <div className="story-flow-title"><Typography.Title level={2}>跟着账单走一遍</Typography.Title><Button type="link" icon={<CodeOutlined/>} onClick={() => navigate(`/lab/tools?entry=story&people=${people}`)}>带 {people} 人账单看代码</Button></div>
      <div className="story-playback-status" role="status"><Tag color={running || replaying ? 'processing' : result?.status === 'completed' ? 'blue' : undefined}>{running ? '正在执行代码' : replaying ? '执行已结束 · 回放中' : result?.status === 'completed' ? '本次执行完成' : result?.status === 'cancelled' ? '已取消' : error ? '执行未完成' : '运行后，四站逐步留下证据'}</Tag><Space size={2}><Button size="small" type="text" disabled={!events.length || running} icon={replaying ? <PauseCircleOutlined/> : <PlayCircleOutlined/>} onClick={replay}>{replaying ? '显示全部' : '慢放过程'}</Button><Button size="small" type="text" disabled={!events.length} icon={<FileTextOutlined/>} onClick={() => { setReplaying(false); setEvidenceOpen(true); }}>原始记录</Button></Space></div>
      <Steps className={`story-steps ${showMotion ? 'is-active' : ''}`} classNames={{ itemRail: 'story-flow-rail', itemIcon: 'story-flow-icon', itemContent: 'story-flow-content' }} titlePlacement="vertical" variant="outlined" responsive={false} current={activeStation} items={['准备输入', '模型请求', '工具执行', '展示输出'].map((title, index) => ({
        title,
        icon: [<TeamOutlined/>, <ApiOutlined/>, <CalculatorOutlined/>, <FileTextOutlined/>][index],
        status: stationEvents[index] ? 'finish' : showMotion && index === activeStation ? 'process' : 'wait',
        content: <div className="story-station-slot">{running || events.length > 0 ? stationContents[index] : <Typography.Text type="secondary">{['把人数和单价记下来', '请计算器算这道题', '接过算式，动手乘', '把金额写回账单'][index]}</Typography.Text>}</div>,
      }))}/>

      <div className="story-conclusion" aria-live="polite">{error ? <Alert className="story-error" type={result?.status === 'cancelled' ? 'warning' : 'error'} showIcon title={error}/> : <Typography.Text strong={!!outputEvent} type={outputEvent ? undefined : 'secondary'}>{outputEvent ? consistent ? `算账的是计算器。模型递过题目，计算器返回 ${amount} 元。` : '结果出来了。打开原始记录，核对它从哪一步来。' : '先运行，再对照四站留下的实际输入与返回值。'}</Typography.Text>}</div>
      </div>
    </div>
    <div className="story-course-section"><div className="story-course-heading"><Typography.Title level={2}>自己写个会办事的助手</Typography.Title><Typography.Text>四个动手实验，从一句问答做到一个 Agent。</Typography.Text></div><CourseRail compact/></div>
    <Modal title={`${runPeople ?? people} 人这次运行的原始记录`} open={evidenceOpen} onCancel={() => setEvidenceOpen(false)} footer={<Button onClick={() => setEvidenceOpen(false)}>返回实验台</Button>} width={900} centered destroyOnHidden><div className="story-event-list" role="region" aria-label="原始执行记录，独立滚动" tabIndex={0}>{events.map(event => <div key={event.id} className="story-event-row"><Space size="small" wrap><Tag>{event.seq}</Tag><Typography.Text strong>{event.title}</Typography.Text><Typography.Text type="secondary">{event.type} · {event.source === 'teaching-simulation' ? '教学模拟' : '代码执行'}</Typography.Text></Space><pre>{evidenceText(event.data)}</pre></div>)}</div></Modal>
  </section>;
}
