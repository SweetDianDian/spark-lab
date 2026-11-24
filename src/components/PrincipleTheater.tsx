import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Button, Card, Collapse, Descriptions, InputNumber, Progress, Select, Slider, Space, Steps, Switch, Table, Tag, Typography } from 'antd';
import type { RefSelectProps } from 'antd';
import { ArrowLeftOutlined, CheckOutlined, CodeOutlined, PauseOutlined, PlayCircleOutlined, ReloadOutlined, StepBackwardOutlined, StepForwardOutlined } from '@ant-design/icons';
import LearningDiagram from './LearningDiagram';
import { agentFrames, agentOutcome, apiCallFrames, apiOutputCase, comparisonGuides, contextFrames, contextPayload, samplingCandidates, samplingCase, samplingFrames, theaterReturnPath, theaterScenes, toolExecutionCase, toolFrames, validateOperands } from '../data/theater';
import type { TheaterFrame, TheaterSceneId } from '../data/theater';
import { getLearningPathItem, getPrincipleDefinition, theaterFrameId } from '../data/learning-path';
import { getLessonJourney } from '../data/journey';
import { getPrincipleProgress, markPrincipleSeen, readLearningState, subscribeLearningState } from '../lib/learning-state';
import './principle-theater.css';

export default function PrincipleTheater() {
  const [params, setParams] = useSearchParams();
  const selectWasUsed = useRef(false);
  const scene = theaterScenes.find(item => item.id === params.get('scene')) ?? theaterScenes[0];
  const back = theaterReturnPath(params.get('returnTo'));
  useEffect(() => {
    if (params.get('scene') === scene.id) return;
    const next = new URLSearchParams(params); next.set('scene', scene.id); setParams(next, { replace: true });
  }, [params, scene.id, setParams]);
  useEffect(() => { selectWasUsed.current = false; }, [scene.id]);
  function selectScene(id: TheaterSceneId) {
    selectWasUsed.current = true;
    const next = new URLSearchParams(params); next.set('scene', id); setParams(next);
  }
  return <section className="cinema-root" aria-label="交互原理讲解"><PrincipleExperiment key={scene.id} scene={scene} back={back} selectScene={selectScene} focusKnowledge={selectWasUsed.current}/></section>;
}

function PrincipleExperiment({ scene, back, selectScene, focusKnowledge }: { scene: typeof theaterScenes[number]; back: string; selectScene: (id: TheaterSceneId) => void; focusKnowledge: boolean }) {
  const navigate = useNavigate();
  const knowledgeRef = useRef<RefSelectProps>(null);
  useEffect(() => { if (focusKnowledge) knowledgeRef.current?.focus({ preventScroll: true }); }, [focusKnowledge]);
  const definition = getPrincipleDefinition(scene.id)!;
  const learningItem = getLearningPathItem(scene.lesson)!;
  const journey = getLessonJourney(scene.lesson);
  const guide = comparisonGuides[scene.id];
  const [progress, setProgress] = useState(() => getPrincipleProgress(scene.id));
  const [learning, setLearning] = useState(() => readLearningState(scene.lesson));
  const [step, setStep] = useState(() => {
    const unseen = getPrincipleProgress(scene.id).firstUnseenFrameId;
    return Math.max(0, definition.requiredFrameIds.indexOf(unseen ?? definition.requiredFrameIds[0]));
  });
  const [playing, setPlaying] = useState(false);
  const [showOutput, setShowOutput] = useState(false);
  const [background, setBackground] = useState(false);
  const [executeTool, setExecuteTool] = useState(false);
  const [left, setLeft] = useState('17');
  const [right, setRight] = useState('23');
  const [maxRounds, setMaxRounds] = useState(3);
  const [temperature, setTemperature] = useState(1.5);
  const [stageVisible, setStageVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(() => !document.hidden);
  const [saveError, setSaveError] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const apiPrompt = '用一句话解释大语言模型。';
  const operands = validateOperands(left, right);
  const frames = useMemo(() => scene.id === 'api-call' ? apiCallFrames() : scene.id === 'sampling' ? samplingFrames() : scene.id === 'context' ? contextFrames(background) : scene.id === 'tools' ? toolFrames(operands.valid, executeTool) : agentFrames(maxRounds), [scene.id, background, operands.valid, executeTool, maxRounds]);
  const position = Math.min(step, frames.length - 1);
  const frame = frames[position];
  const frameId = theaterFrameId(frame);
  const atEnd = position === frames.length - 1;
  useEffect(() => subscribeLearningState(() => { setProgress(getPrincipleProgress(scene.id)); setLearning(readLearningState(scene.lesson)); }), [scene.id, scene.lesson]);
  useEffect(() => {
    const element = stageRef.current;
    const root = contentRef.current;
    if (!element || !root) return;
    const observer = new IntersectionObserver(entries => setStageVisible(entries[0].isIntersecting && entries[0].intersectionRatio >= 0.4), { root, threshold: [0, 0.4, 1] });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const changed = () => { setPageVisible(!document.hidden); if (document.hidden) setPlaying(false); };
    document.addEventListener('visibilitychange', changed);
    return () => document.removeEventListener('visibilitychange', changed);
  }, []);
  useEffect(() => {
    if (!stageVisible || !pageVisible) return;
    const timer = window.setTimeout(() => { if (!document.hidden) setSaveError(!markPrincipleSeen(scene.id, frameId)); }, 1000);
    return () => window.clearTimeout(timer);
  }, [scene.id, frameId, stageVisible, pageVisible]);
  useEffect(() => {
    if (!playing || !stageVisible || !pageVisible) return;
    if (atEnd) { setPlaying(false); return; }
    const timer = window.setTimeout(() => { if (document.hidden) setPlaying(false); else setStep(value => Math.min(value + 1, frames.length - 1)); }, 3600);
    return () => window.clearTimeout(timer);
  }, [playing, position, atEnd, frames.length, stageVisible, pageVisible]);
  function intervene(at: number) { setPlaying(false); setStep(at); }
  function revealExplanation() {
    const container = contentRef.current;
    const stage = stageRef.current;
    if (!container || !stage) return;
    const stageBox = stage.getBoundingClientRect();
    const containerBox = container.getBoundingClientRect();
    const inset = Math.max(16, (container.clientHeight - stageBox.height) / 2);
    container.scrollTo({ top: Math.max(0, container.scrollTop + stageBox.top - containerBox.top - inset), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  function move(delta: number) { setPlaying(false); setStep(Math.max(0, Math.min(position + delta, frames.length - 1))); revealExplanation(); }
  function play() {
    if (atEnd) setStep(0);
    if (!playing) revealExplanation();
    setPlaying(value => !value);
  }
  function jumpToFrame(id: string) {
    setPlaying(false);
    revealExplanation();
    const index = frames.findIndex(item => theaterFrameId(item) === id);
    if (index >= 0) { setStep(index); return; }
    setLeft('17'); setRight('23'); setMaxRounds(3);
    setStep(Math.max(0, definition.requiredFrameIds.indexOf(id)));
  }

  const toolCase = toolExecutionCase(left, right, executeTool);
  const agentCase = agentOutcome(maxRounds);
  const sampleA = samplingCase(0.2);
  const sampleB = samplingCase(temperature);
  const observation = scene.id === 'api-call'
    ? showOutput ? '两组都显示同一份回答。显示开关没有改动请求和响应。' : 'B 的页面没有回答，但示例响应仍在。消失的是显示，不是模型调用步骤。'
    : scene.id === 'context'
      ? background ? '两组现在携带相同的背景，示例回答也相同。' : 'B 少了一条“喜欢做饭”的消息，示例回答从厨房比喻变成一般解释。'
      : scene.id === 'tools'
        ? toolCase.status === 'request-only' ? 'A、B 目前都只有工具请求，没有计算结果。打开 B 的执行开关再看。' : toolCase.status === 'rejected' ? `B 停在参数校验，没有执行乘法。${toolCase.reason}` : `相同请求下，A 没有结果，B 真正计算得到了 ${toolCase.result}。`
        : scene.id === 'agent'
          ? agentCase.hasSummary ? `B 允许最多 ${maxRounds} 轮，实际第 3 轮已生成总结；不需要用完额度。` : maxRounds === 2 ? 'B 已拿到 RAG 资料和 391，但第 3 轮尚未开始，所以还缺最终总结。' : 'B 只拿到 RAG 资料，计算与最终总结都还没完成，调用额度已经用完。'
          : temperature === 0.2 ? '两组温度相同，分布和选择也相同。现在只调 B 的温度。' : sampleA.chosen === sampleB.chosen ? `分布改变了，但 u = 0.80 仍在“${sampleB.word}”区间；本次选择没有变化。` : `同一个 u = 0.80，在 A 落入“${sampleA.word}”，在 B 落入“${sampleB.word}”。变的是区间长度。`;

  return <div className="cinema-layout">
    <aside className="cinema-sidebar" aria-label="知识与学习步骤">
      <div className="cinema-sidebar-head">
      <Button type="link" className="cinema-back" icon={<ArrowLeftOutlined/>} onClick={() => navigate(back)}>{back.startsWith('/lab/') ? back.includes('replay=') ? '返回实验回放' : '返回代码实验' : back === '/' ? '返回首页' : '返回学习路线'}</Button>
      <div className="cinema-knowledge-select"><Typography.Text type="secondary">当前知识</Typography.Text><Select ref={knowledgeRef} aria-label="选择学习的知识" value={scene.id} onChange={selectScene} options={theaterScenes.map(item => ({ value: item.id, label: item.title }))}/></div>
      <div className="cinema-learning-progress">
        <Typography.Text>原理已浏览 {progress.viewedCount} / {progress.totalCount}</Typography.Text>
        <Progress percent={progress.totalCount ? progress.viewedCount / progress.totalCount * 100 : 0} showInfo={false} status="normal" aria-label={`原理已浏览 ${progress.viewedCount} / ${progress.totalCount}`}/>
        <Typography.Text type="secondary">实操：{learningItem.practiceAvailability === 'upcoming' ? '尚未开放' : learning.practice.passed ? '已跑通' : learning.practice.hasRun ? '已运行，待验收' : '尚未完成'}</Typography.Text>
        {learning.practice.lastRun && !learning.practice.lastRun.passed && <Typography.Text type="secondary">最近一次：{learning.practice.lastRun.status === 'failed' ? '运行失败' : learning.practice.lastRun.status === 'cancelled' ? '已停止' : '尚未通过验收'}</Typography.Text>}
      </div>
      </div>
      <div className="cinema-sidebar-scroll" role="region" aria-label="可滚动的原理步骤目录" tabIndex={0}>
      <Collapse className="cinema-step-directory" ghost defaultActiveKey={['steps']} items={[{
        key: 'steps', label: `逐步解释 · ${progress.completed ? '已全部浏览' : `${progress.remainingFrameIds.length} 步未看`}`,
        children: <><Steps orientation="vertical" size="small" current={definition.frames.findIndex(item => item.id === frameId)} onChange={index => jumpToFrame(definition.frames[index].id)} items={definition.frames.map(item => {
          const seen = progress.seenFrameIds.includes(item.id);
          return { key: item.id, title: item.title, content: seen ? '已看' : '未看', status: item.id === frameId ? 'process' as const : seen ? 'finish' as const : 'wait' as const };
        })}/><Typography.Paragraph className="cinema-progress-note" type="secondary">已浏览只表示看过解释步骤，不代表掌握，也不会替代代码实操。</Typography.Paragraph></>,
      }]}/>
      {progress.firstUnseenFrameId && <Button type="link" className="cinema-resume" onClick={() => jumpToFrame(progress.firstUnseenFrameId!)}>继续未看的解释</Button>}
      {saveError && <Alert type="warning" showIcon title="这次浏览进度未能保存" description="请检查浏览器存储。"/>}
      </div>
    </aside>
    <div className="cinema-main">
      <header className="cinema-heading"><Typography.Text type="secondary">{scene.title} · 对照实验</Typography.Text><Typography.Title level={3}>{scene.question}</Typography.Title><Typography.Text type="secondary">{scene.note}</Typography.Text></header>
      <Card className="cinema-screen" aria-label={`${scene.title}因果对照`} styles={{ body: { height: '100%', padding: 0 } }}>
        <div className="cinema-content-scroll" ref={contentRef} role="region" aria-label="可滚动的原理讲解内容" tabIndex={0}>
        <div className="cinema-task"><Typography.Text strong>动手试一次</Typography.Text><p>{guide.task}</p></div>
        <div className="cinema-intervention" aria-label="只改变一个实验条件">
          {scene.id === 'api-call' && <Toggle label="在 B 显示回答" checked={showOutput} onChange={value => { setShowOutput(value); intervene(3); }}/>}
          {scene.id === 'context' && <Toggle label="B 包含“我喜欢做饭”的背景" checked={background} onChange={value => { setBackground(value); intervene(1); }}/>}
          {scene.id === 'tools' && <><Toggle label="让 B 执行工具" checked={executeTool} onChange={value => { setExecuteTool(value); intervene(value ? 2 : 1); }}/><div className="cinema-number-pair"><Typography.Text type="secondary">共同算式</Typography.Text><InputNumber aria-label="第一个乘数" stringMode step="1" value={left || null} status={!operands.valid ? 'error' : undefined} onChange={value => { setLeft(value === null ? '' : String(value)); intervene(0); }}/><span>×</span><InputNumber aria-label="第二个乘数" stringMode step="1" value={right || null} status={!operands.valid ? 'error' : undefined} onChange={value => { setRight(value === null ? '' : String(value)); intervene(0); }}/></div></>}
          {scene.id === 'agent' && <div className="cinema-range-label"><Typography.Text>B 的模型调用上限 <strong>{maxRounds} 轮</strong></Typography.Text><Slider ariaLabelForHandle="模型调用轮数上限" min={1} max={5} step={1} value={maxRounds} marks={{ 1: '1 轮', 5: '5 轮' }} tooltip={{ formatter: value => `${value} 轮` }} onChange={value => { setMaxRounds(value); intervene(0); }}/></div>}
          {scene.id === 'sampling' && <><div className="cinema-range-label"><Typography.Text>B 的温度 <strong>{temperature.toFixed(1)}</strong></Typography.Text><Slider ariaLabelForHandle="采样温度" min={0.2} max={2} step={0.1} value={temperature} marks={{ 0.2: '更集中', 2: '更分散' }} tooltip={{ formatter: value => value?.toFixed(1) }} onChange={value => { setTemperature(value); intervene(1); }}/></div><Typography.Text type="secondary">共同随机落点 <strong>u = 0.80</strong></Typography.Text></>}
        </div>
        <Typography.Paragraph className="cinema-constant" type="secondary">保持不变：{guide.unchanged}</Typography.Paragraph>
        <div className="cinema-observation" aria-live="polite" aria-atomic="true"><Alert type={scene.id === 'tools' && toolCase.status === 'rejected' ? 'warning' : 'info'} showIcon title="当前观察" description={observation}/></div>
        <div className="cinema-comparison-stage">
          {scene.id === 'api-call' && <ApiComparison prompt={apiPrompt} showOutput={showOutput}/>}
          {scene.id === 'context' && <ContextComparison background={background}/>}
          {scene.id === 'tools' && <ToolsComparison left={left} right={right} execute={executeTool}/>}
          {scene.id === 'agent' && <AgentComparison maxRounds={maxRounds}/>}
          {scene.id === 'sampling' && <SamplingComparison temperature={temperature}/>}
        </div>
        <div className="cinema-why"><Typography.Text strong>为什么会这样</Typography.Text><p>{guide.why}</p></div>
        <div className="cinema-explanation" ref={stageRef}>
          <div className="cinema-explanation-title"><Typography.Text type="secondary">逐步解释当前结果</Typography.Text><Typography.Text type="secondary">第 {position + 1} / {frames.length} 步</Typography.Text></div>
          <MechanismDiagram sceneId={scene.id} frame={frame} showOutput={showOutput} executeTool={executeTool} valid={operands.valid}/>
          <div className="cinema-subtitle" aria-live="polite"><Typography.Title level={5}>{frame.title}</Typography.Title><Typography.Paragraph type="secondary">{frame.narration}</Typography.Paragraph>{scene.id === 'agent' && frame.payload && <Typography.Text code>{frame.payload}</Typography.Text>}</div>
        </div>
        <div className="cinema-afterword"><div><Typography.Text type="secondary">{scene.note}</Typography.Text>{journey && <Typography.Paragraph className="cinema-project-link" type="secondary">在学习助手中：{journey.projectContribution}</Typography.Paragraph>}</div>{learningItem.practiceAvailability === 'available' ? <Button icon={<CodeOutlined/>} onClick={() => navigate(`/lab/${scene.lesson}`)}>去代码里验证</Button> : <Button onClick={() => navigate(`/explore?at=${scene.lesson}`)}>实操尚未开放 · 查看章节</Button>}</div>
        </div>
      </Card>
      <Card className="cinema-player" size="small" aria-label="原理演示控制"><div className="cinema-player-layout"><Space className="cinema-transport"><Button aria-label="上一步" disabled={position === 0} icon={<StepBackwardOutlined/>} onClick={() => move(-1)}>上一步</Button><Button type="primary" className="cinema-play-button" icon={playing ? <PauseOutlined/> : atEnd ? <ReloadOutlined/> : <PlayCircleOutlined/>} onClick={play}>{playing ? '暂停' : atEnd ? '重新解释' : '自动讲解'}</Button><Button aria-label="下一步" disabled={atEnd} icon={<StepForwardOutlined/>} iconPlacement="end" onClick={() => move(1)}>下一步</Button></Space><div className="cinema-playback-position"><Slider min={0} max={frames.length - 1} step={1} value={position} ariaLabelForHandle="选择解释步骤" ariaValueTextFormatterForHandle={value => `第 ${value + 1} 步，共 ${frames.length} 步：${frames[value].title}`} tooltip={{ formatter: value => value === undefined ? null : frames[value].title }} onChange={value => { intervene(value); revealExplanation(); }}/><Typography.Text type="secondary">{position + 1} / {frames.length}</Typography.Text></div></div></Card>
    </div>
  </div>;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <Space className="cinema-toggle"><Switch aria-label={label} checked={checked} checkedChildren="开" unCheckedChildren="关" onChange={onChange}/><Typography.Text>{label}</Typography.Text></Space>;
}

function CasePanel({ name, title, children, baseline = false }: { name: string; title: string; children: ReactNode; baseline?: boolean }) {
  return <Card size="small" className="cinema-case" title={<div className="cinema-case-title"><Typography.Text type="secondary">{name}</Typography.Text><Typography.Text strong>{title}</Typography.Text></div>} extra={<Tag color={baseline ? 'default' : 'blue'}>{baseline ? 'A' : 'B'}</Tag>}>{children}</Card>;
}
function DataDetails({ title, value }: { title: string; value: unknown }) {
  return <Collapse className="cinema-data-details" size="small" ghost items={[{ key: 'data', label: title, children: <pre tabIndex={0}>{JSON.stringify(value, null, 2)}</pre> }]}/>;
}
function OutputSurface({ title, children }: { title: string; children: ReactNode }) {
  return <Card className="cinema-output-surface" size="small" type="inner" title={title}>{children}</Card>;
}

function ApiComparison({ prompt, showOutput }: { prompt: string; showOutput: boolean }) {
  const a = apiOutputCase(prompt, true); const b = apiOutputCase(prompt, showOutput);
  return <><Typography.Paragraph className="cinema-shared-input">共同问题：{prompt}</Typography.Paragraph><div className="cinema-comparison">
    {[a, b].map((item, index) => <CasePanel key={index} name={index === 0 ? 'A · 基线' : 'B · 你的条件'} title={item.showOutput ? '显示回答' : '隐藏回答'} baseline={index === 0}><Descriptions className="cinema-evidence" size="small" column={1} items={[{ key: 'call', label: '调用步骤', children: <>保留 <Typography.Text code>await lab.model(...)</Typography.Text></> }, { key: 'response', label: '响应内容', children: <Space><CheckOutlined/>text 与 toolCalls 都存在</Space> }]}/><OutputSurface title="页面输出">{item.displayedText ? <p>{item.displayedText.replace('教学示例：', '')}</p> : <Typography.Paragraph type="secondary">没有显示内容<br/>响应没有丢失，只是没有展示。</Typography.Paragraph>}</OutputSurface><Typography.Text className="cinema-code-line" code>{item.showOutput ? 'lab.output(response.text)' : '// 不执行 lab.output(response.text)'}</Typography.Text></CasePanel>)}
  </div><DataDetails title="核对：两组请求、响应与显示值" value={{ A: a, B: b }}/></>;
}

function ContextComparison({ background }: { background: boolean }) {
  const a = contextPayload(true); const b = contextPayload(background);
  return <><Typography.Paragraph className="cinema-shared-input">同一个问题：大语言模型是什么？</Typography.Paragraph><div className="cinema-comparison">{[a, b].map((item, index) => <CasePanel key={index} name={index === 0 ? 'A · 含背景' : 'B · 你的条件'} title={index === 0 || background ? '消息里有“喜欢做饭”' : '消息里没有“喜欢做饭”'} baseline={index === 0}><Descriptions size="small" className="cinema-message-list" column={1} items={[{ name: '规则', text: '用熟悉的例子，简单解释。' }, { name: '背景', text: index === 0 || background ? '我喜欢做饭。' : '这一条没有放入请求', missing: index !== 0 && !background }, { name: '问题', text: '大语言模型是什么？' }].map(message => ({ key: message.name, label: <Tag color={message.name === '背景' && !message.missing ? 'blue' : 'default'}>{message.name}</Tag>, children: <Typography.Text type={message.missing ? 'secondary' : undefined}>{message.text}</Typography.Text> }))}/><OutputSurface title="规则生成的教学回答"><p>{item.answer}</p></OutputSurface></CasePanel>)}</div><DataDetails title="核对：A、B 实际携带的消息列表" value={{ A: a.messages, B: b.messages }}/></>;
}

function ToolsComparison({ left, right, execute }: { left: string; right: string; execute: boolean }) {
  const a = toolExecutionCase(left, right, false); const b = toolExecutionCase(left, right, execute);
  return <><Typography.Paragraph className="cinema-shared-input">两组收到同一请求：<Typography.Text code>calculator(&quot;{left || '空'} * {right || '空'}&quot;)</Typography.Text></Typography.Paragraph><div className="cinema-comparison">{[a, b].map((item, index) => <CasePanel key={index} name={index === 0 ? 'A · 仅有请求' : 'B · 你的程序'} title={item.status === 'request-only' ? '没有调用工具' : item.status === 'rejected' ? '校验失败，禁止执行' : '校验通过，执行乘法'} baseline={index === 0}><Descriptions className="cinema-evidence" size="small" column={1} items={[{ key: 'args', label: '请求参数', children: <Typography.Text code>{left || '空'} * {right || '空'}</Typography.Text> }, { key: 'behavior', label: '程序行为', children: item.status === 'request-only' ? '到工具请求为止' : item.status === 'rejected' ? '停在参数校验' : '校验 → 执行 → 返回' }]}/><OutputSurface title="工具结果">{item.result !== null ? <Typography.Title level={2} className="cinema-calculated-value">{item.result}</Typography.Title> : <Typography.Paragraph type="secondary">没有结果</Typography.Paragraph>}<Typography.Paragraph className="cinema-case-explanation" type="secondary">{item.reason}</Typography.Paragraph></OutputSurface><Typography.Text className="cinema-code-line" code>{item.status === 'request-only' ? '// 尚未调用 lab.tool(...)' : item.status === 'rejected' ? '参数无效 → 不执行乘法' : 'await lab.tool(name, arguments)'}</Typography.Text></CasePanel>)}</div><DataDetails title="核对：工具请求、校验状态与结果" value={{ A: a, B: b }}/></>;
}

function AgentComparison({ maxRounds }: { maxRounds: number }) {
  const a = agentOutcome(3); const b = agentOutcome(maxRounds);
  return <><Typography.Paragraph className="cinema-shared-input">同一个任务：查询 RAG → 计算 17 × 23 → 总结</Typography.Paragraph><div className="cinema-comparison">{[a, b].map((item, index) => <CasePanel key={index} name={index === 0 ? 'A · 基线 3 轮' : `B · 上限 ${maxRounds} 轮`} title={item.hasSummary ? '拿到证据，也完成总结' : '停止了，但任务还没完成'} baseline={index === 0}><Table size="small" className="cinema-evidence-list" pagination={false} showHeader={false} rowKey="title" dataSource={[{ title: 'RAG 资料', present: item.hasSearch, state: '已获取' }, { title: '计算结果 391', present: item.hasCalculation, state: '已获取' }, { title: '最终总结', present: item.hasSummary, state: '已生成' }]} columns={[{ dataIndex: 'title', title: '证据' }, { key: 'state', title: '状态', align: 'right', render: (_, evidence) => <Tag color={evidence.present ? 'blue' : 'default'}>{evidence.present ? evidence.state : '还缺'}</Tag> }]}/><OutputSurface title="这条教学路径的最终状态"><p>{item.summary ?? '已有内容保留在 history 中，尚未进入生成总结的那一轮。'}</p><Typography.Paragraph className="cinema-case-explanation" type="secondary">实际调用 {item.calls} 轮 · {item.stopReason}</Typography.Paragraph></OutputSurface></CasePanel>)}</div><DataDetails title="核对：两组保留的证据与停止原因" value={{ A: a, B: b }}/></>;
}

function SamplingComparison({ temperature }: { temperature: number }) {
  const a = samplingCase(0.2); const b = samplingCase(temperature);
  const rows = samplingCandidates.map((candidate, index) => ({ key: candidate.text, candidate: candidate.text, a: a.probabilities[index], b: b.probabilities[index] }));
  const probability = (value: number, baseline = false) => <Progress percent={value * 100} size="small" status="normal" strokeColor={baseline ? '#8b97ab' : undefined} format={() => value < .001 ? '<0.1%' : `${(value * 100).toFixed(1)}%`}/>;
  return <><Typography.Paragraph className="cinema-shared-input">共同开头：一只猫正在…… · 固定随机落点 u = 0.80</Typography.Paragraph><Table className="cinema-sampling-table" size="small" pagination={false} dataSource={rows} columns={[{ title: '候选', dataIndex: 'candidate', width: 90 }, { title: 'A · 温度 0.2', dataIndex: 'a', render: (value: number) => probability(value, true) }, { title: `B · 温度 ${temperature.toFixed(1)}`, dataIndex: 'b', render: (value: number) => probability(value) }]}/><div className="cinema-comparison cinema-sampling-results">{[a, b].map((item, index) => <CasePanel key={index} name={index === 0 ? 'A · 原来的区间' : 'B · 调整后的区间'} title={`选中：${item.word}`} baseline={index === 0}><Slider range disabled min={0} max={1} step={0.001} value={[item.start, item.end]} marks={{ 0: '0', 0.8: 'u = 0.80', 1: '1' }} ariaLabelForHandle={['选中区间左边界', '选中区间右边界']} tooltip={{ open: false }}/><Typography.Paragraph className="cinema-interval-reason" type="secondary">固定落点 0.80 在选中区间 {item.start.toFixed(3)}—{item.end.toFixed(3)} 内</Typography.Paragraph><Typography.Paragraph className="cinema-sampled-sentence">一只猫正在<Typography.Text strong>{item.word}</Typography.Text></Typography.Paragraph></CasePanel>)}</div><DataDetails title="查看计算依据：固定分数、概率与抽样区间" value={{ scores: samplingCandidates, randomDraw: 0.8, formula: 'softmax(scores / temperature)', A: a, B: b }}/></>;
}

function MechanismDiagram({ sceneId, frame, showOutput, executeTool, valid }: { sceneId: TheaterSceneId; frame: TheaterFrame; showOutput: boolean; executeTool: boolean; valid: boolean }) {
  const steps: { phase: string; label: string }[] = sceneId === 'api-call' ? [{ phase: 'input', label: '同一份消息' }, { phase: 'request', label: '调用模型' }, { phase: 'model', label: '取得响应' }, { phase: 'answer', label: showOutput ? 'B 显示 text' : 'B 隐藏 text' }]
    : sceneId === 'context' ? [{ phase: 'input', label: '相同问题' }, { phase: 'assemble', label: '是否携带背景' }, { phase: 'model', label: '根据消息生成' }, { phase: 'answer', label: '不同解释方式' }]
      : sceneId === 'tools' ? [{ phase: 'input', label: '相同算式' }, { phase: 'request', label: '工具请求' }, { phase: 'validate', label: valid ? '参数校验' : '参数无效，停止' }, { phase: 'calculate', label: executeTool && valid ? '执行乘法' : '未执行' }, { phase: 'answer', label: executeTool && valid ? '工具结果' : '无工具结果' }]
        : sceneId === 'agent' ? [{ phase: 'input', label: '任务与上限' }, { phase: 'model', label: `模型 · 第 ${frame.round || 1} 轮` }, { phase: 'tool', label: '执行工具' }, { phase: 'observe', label: '结果回到下一轮' }, { phase: frame.phase === 'stop' ? 'stop' : 'answer', label: frame.phase === 'stop' ? '预算停止' : '结束判断' }]
          : [{ phase: 'input', label: '固定分数' }, { phase: 'distribution', label: '温度改变分布' }, { phase: 'draw', label: '同一个 u = 0.80' }, { phase: 'answer', label: '落入哪个区间' }];
  return <LearningDiagram nodes={steps.map(item => ({ id: item.phase, title: item.label, state: item.phase === frame.phase ? (item.phase === 'validate' && !valid ? 'error' : 'active') : 'idle', dimmed: sceneId === 'tools' && (!valid || !executeTool) && (item.phase === 'calculate' || item.phase === 'answer') }))} edges={steps.slice(1).map((item, index) => ({ source: steps[index].phase, target: item.phase, emphasis: item.phase === frame.phase, dashed: sceneId === 'tools' && (!valid || !executeTool) && (item.phase === 'calculate' || item.phase === 'answer') }))} selectedId={frame.phase} nodeWidth={150} height={190} controls={false} ariaLabel="解释结果的执行关系"/>;
}
