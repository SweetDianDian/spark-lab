import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Alert, Breadcrumb, Button, Card, Collapse, Empty, Flex, message, Radio, Result, Select, Segmented, Slider, Space, Spin, Steps, Tabs, Tag, Tooltip, Typography } from 'antd';
import { ArrowLeft, BookOpen, Check, Code2, Film, Maximize2, Pause, Play, RotateCcw, Save, Square, Terminal } from 'lucide-react';
import { lessons } from '../data/lessons';
import { getLessonJourney } from '../data/journey';
import { runCode } from '../runtime';
import { validateLessonRun, nodeExecutionState } from '../lib/progress';
import { readLearningState, recordLessonRun, subscribeLearningState } from '../lib/learning-state';
import { completeLesson, getCompleted, getDraft, getLanguage, getRuns, saveRun, setDraft, setLanguage } from '../lib/storage';
import type { Language, Lesson, RunEvent, RunMode, RunResult, SavedRun } from '../types';
import CodeEditor from './CodeEditor';
import LearningDiagram from './LearningDiagram';
import './workspace-experience.css';

type CodeSnapshot = { code: string; language: Language; mode: RunMode };
type ExecutedAttempt = { result: RunResult; snapshot: CodeSnapshot };
type ObservationPanel = 'compare' | 'flow' | 'output' | 'principle' | 'learning';
type ExperimentSession = {
  version: 1;
  lessonId: string;
  result: RunResult | null;
  runSnapshot: CodeSnapshot;
  language: Language;
  mode: RunMode;
  prediction: number | null;
  understandingConfirmed: boolean;
  eligibleRunId: string | null;
  saved: boolean;
  attempts?: ExecutedAttempt[];
};

function sessionKey(lessonId: string) { return `spark-lab:v1:workspace:${lessonId}`; }

function restoreExperiment(lessonId: string): ExperimentSession | null {
  try {
    const raw = sessionStorage.getItem(sessionKey(lessonId));
    if (!raw) return null;
    const value = JSON.parse(raw) as ExperimentSession;
    const validLanguage = (language: unknown) => ['typescript', 'javascript', 'python'].includes(String(language));
    const validMode = (mode: unknown) => mode === 'demo' || mode === 'live';
    if (value.version !== 1 || value.lessonId !== lessonId || !value.runSnapshot ||
      typeof value.runSnapshot.code !== 'string' || !validLanguage(value.runSnapshot.language) ||
      !validMode(value.runSnapshot.mode) || !validLanguage(value.language) || !validMode(value.mode) ||
      (value.prediction !== null && (!Number.isInteger(value.prediction) || value.prediction < 0 || value.prediction > 2))) return null;
    if (value.result && (typeof value.result.id !== 'string' || !Array.isArray(value.result.events) ||
      !['completed', 'failed', 'cancelled'].includes(value.result.status) ||
      !value.result.events.every(event => event && typeof event.seq === 'number' && typeof event.type === 'string' && typeof event.nodeId === 'string'))) return null;
    // Only the most recent actual runs belong in the comparison. Restoring a
    // session does not create another run, and notebook replays never enter it.
    const attempts = Array.isArray(value.attempts) ? value.attempts.filter(attempt =>
      attempt && attempt.result && typeof attempt.result.id === 'string' &&
      Array.isArray(attempt.result.events) && ['completed', 'failed', 'cancelled'].includes(attempt.result.status) &&
      attempt.result.events.every(event => event && typeof event.seq === 'number' && typeof event.type === 'string') &&
      attempt.snapshot && typeof attempt.snapshot.code === 'string' &&
      validLanguage(attempt.snapshot.language) && validMode(attempt.snapshot.mode)) : [];
    value.attempts = [...new Map(attempts.map(attempt => [attempt.result.id, attempt])).values()].slice(-2);
    // Older sessions had one result and its execution identity, but no pair.
    if (!value.attempts.length && value.result && value.eligibleRunId === value.result.id) {
      value.attempts = [{ result: value.result, snapshot: value.runSnapshot }];
    }
    return value;
  } catch { return null; }
}

export default function Workspace({ onConnect }: { onConnect: () => void }) {
  const { lessonId } = useParams();
  const navigate = useNavigate();
  const lesson = lessons.find(item => item.id === lessonId);
  return lesson?.available ? <Experiment key={lesson.id} lesson={lesson} onConnect={onConnect}/> : <Result status="info" title="这章的代码实验尚未开放" extra={<Button type="primary" onClick={() => navigate('/explore')}>回到学习路径</Button>}/>;
}

function formatData(data: unknown): string {
  if (typeof data === 'string') return data;
  if (data === undefined || data === null) return '这一步没有附加数据';
  return JSON.stringify(data, null, 2);
}

function readableError(message: string): string {
  const lines = message.trim().split('\n').filter(Boolean);
  return (lines.at(-1) ?? message).replace(/^pyodide\.ffi\.JsException:\s*(?:Error:\s*)?/, '');
}

function AttemptEvidence({ attempt, label, pending, stale }: { attempt?: ExecutedAttempt; label: string; pending: string; stale?: boolean }) {
  const inputs = attempt?.result.events.filter(event => event.type === 'model.started').map(event => event.data) ?? [];
  const preparedInputs = attempt?.result.events.filter(event => event.type === 'step' && event.nodeId === 'input').map(event => event.data) ?? [];
  const displayedInputs = preparedInputs.length ? preparedInputs : inputs;
  const outputs = attempt?.result.events.filter(event => event.type === 'output').map(event => event.data) ?? [];
  return <Card size="small" className="lab-attempt" title={label} extra={attempt && <Tag color={attempt.result.status === 'failed' ? 'error' : attempt.result.status === 'cancelled' ? 'warning' : 'processing'}>{attempt.result.status === 'failed' ? '运行失败' : attempt.result.status === 'cancelled' ? '已停止' : '已执行'}</Tag>}>
    {attempt ? <>
      <Typography.Paragraph type="secondary" className="lab-attempt-meta">{attempt.snapshot.language} · {attempt.snapshot.mode === 'demo' ? '教学模拟' : '真实 API'} · {attempt.result.id.slice(0, 8)}</Typography.Paragraph>
      {stale && <Alert className="lab-stale-evidence" type="warning" showIcon title="代码已修改，下面仍是修改前的结果。"/>}
      <div className="lab-attempt-value"><Typography.Text type="secondary">{preparedInputs.length ? '输入步骤记录' : '实际模型输入'}</Typography.Text><pre>{displayedInputs.length ? formatData(displayedInputs.length === 1 ? displayedInputs[0] : displayedInputs) : '本次没有输入步骤或模型调用。'}</pre></div>
      <div className="lab-attempt-value"><Typography.Text type="secondary">{attempt.result.error ? '错误 / 停止原因' : '实际输出'}</Typography.Text><pre>{attempt.result.error ? readableError(attempt.result.error) : outputs.length ? formatData(outputs.length === 1 ? outputs[0] : outputs) : '本次没有 lab.output 输出。'}</pre></div>
      <Collapse size="small" ghost items={[
        ...(preparedInputs.length > 0 ? [{ key: 'requests', label: `模型实际收到什么？ · ${inputs.length} 次调用`, children: <pre className="lab-evidence-code">{inputs.length ? formatData(inputs.length === 1 ? inputs[0] : inputs) : '本次没有发起模型调用。'}</pre> }] : []),
        { key: 'source', label: '查看这次运行的代码', children: <pre className="lab-evidence-code">{attempt.snapshot.code}</pre> },
      ]}/>
    </> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={pending}/>}
  </Card>;
}

function Experiment({ lesson, onConnect }: { lesson: Lesson; onConnect: () => void }) {
  const journey = getLessonJourney(lesson.id);
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const replayId = search.get('replay');
  const fromStory = lesson.id === 'tools' && search.get('entry') === 'story';
  const [restored] = useState(() => replayId ? null : restoreExperiment(lesson.id));
  const [learning, setLearning] = useState(() => readLearningState(lesson.id));
  const [language, updateLanguage] = useState<Language>(() => restored?.language ?? getLanguage());
  const [code, setCode] = useState(() => {
    const initialLanguage = restored?.language ?? getLanguage();
    return getDraft(lesson.id, initialLanguage, lesson.starter[initialLanguage]);
  });
  const [mode, setMode] = useState<RunMode>(restored?.mode ?? 'demo');
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<RunEvent[]>(restored?.result?.events ?? []);
  const [result, setResult] = useState<RunResult | null>(restored?.result ?? null);
  const [attempts, setAttempts] = useState<ExecutedAttempt[]>(restored?.attempts ?? []);
  const [prediction, setPrediction] = useState<number | null>(restored?.prediction ?? null);
  const [understandingConfirmed, setUnderstandingConfirmed] = useState(restored?.understandingConfirmed === true);
  const [introOpen, setIntroOpen] = useState(false);
  const [panel, setPanel] = useState<ObservationPanel>('compare');
  const [selectedNode, setSelectedNode] = useState(fromStory ? 'tool' : '');
  const [cursor, setCursor] = useState((restored?.result?.events.length ?? 0) - 1);
  const [playing, setPlaying] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [saved, setSaved] = useState(restored?.saved === true);
  const [freshRun, setFreshRun] = useState(false);
  const [continuedRunId, setContinuedRunId] = useState<string | null>(() =>
    restored?.result && restored.eligibleRunId === restored.result.id ? restored.result.id : null);
  const [replay, setReplay] = useState(!!replayId);
  const [messageApi, messageContext] = message.useMessage();
  const notify = (content: string) => { void messageApi.info(content); };
  const [saveError, setSaveError] = useState('');
  const [complete, setComplete] = useState(false);
  const [hint, setHint] = useState(false);
  const [scrollTarget, setScrollTarget] = useState<'prediction' | 'completion' | null>(null);
  const panelScrollRefs = useRef<Partial<Record<ObservationPanel, HTMLDivElement>>>({});
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const generation = useRef(0);
  const runSnapshot = useRef<CodeSnapshot>(restored?.runSnapshot ?? { code, language, mode });
  useEffect(() => {
    const refresh = () => setLearning(readLearningState(lesson.id));
    refresh();
    return subscribeLearningState(refresh);
  }, [lesson.id]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); generation.current++; }; }, []);
  useEffect(() => { document.body.classList.toggle('presenting', presenting); return () => document.body.classList.remove('presenting'); }, [presenting]);
  useEffect(() => { if (!replay && !replayId) setDraft(lesson.id, language, code); }, [code, lesson.id, language, replay, replayId]);
  useEffect(() => {
    if (!replayId) return;
    const run = getRuns().find(item => item.id === replayId && item.lessonId === lesson.id);
    if (!run) { notify('这条运行记录已经不存在了'); return; }
    setReplay(true); setFreshRun(false); setContinuedRunId(null); setIntroOpen(false); setCode(run.code); updateLanguage(run.language); setMode(run.mode); setEvents(run.events); setResult(run); setCursor(0); setPlaying(false); setSaved(true);
    runSnapshot.current = { code: run.code, language: run.language, mode: run.mode };
  }, [replayId, lesson.id]);
  function rememberExperiment(): boolean {
    if (replay || replayId) return true;
    if (running) return false;
    const session: ExperimentSession = {
      version: 1, lessonId: lesson.id, result, runSnapshot: runSnapshot.current,
      language, mode, prediction, understandingConfirmed, saved, attempts,
      eligibleRunId: result && (freshRun || continuedRunId === result.id) ? result.id : null,
    };
    try { sessionStorage.setItem(sessionKey(lesson.id), JSON.stringify(session)); return true; }
    catch { return false; }
  }
  useEffect(() => { rememberExperiment(); }, [lesson.id, result, code, language, mode, prediction, understandingConfirmed, saved, freshRun, continuedRunId, replay, replayId, running, attempts]);
  useEffect(() => { if (!playing) return; const t = setInterval(() => setCursor(current => { if (current >= events.length - 1) { setPlaying(false); return current; } return current + 1; }), 850); return () => clearInterval(t); }, [playing, events.length]);
  useEffect(() => {
    if (panel !== 'learning' || !scrollTarget) return;
    const frame = requestAnimationFrame(() => {
      const container = panelScrollRefs.current.learning;
      const target = document.getElementById(`${scrollTarget}-${lesson.id}`);
      if (!container || !target) return;
      const top = container.scrollTop + target.getBoundingClientRect().top - container.getBoundingClientRect().top - 12;
      // Do not use scrollIntoView: it can also move the shell or another pane.
      container.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
      target.querySelector<HTMLElement>('[role="button"],button,input')?.focus({ preventScroll: true });
      setScrollTarget(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [panel, scrollTarget, introOpen, complete, lesson.id]);
  useEffect(() => { if (running) panelScrollRefs.current.compare?.scrollTo({ top: 0 }); }, [running]);
  async function run() {
    if (running || replay) return;
    const token = ++generation.current;
    controller.current = new AbortController();
    const executionSnapshot = { code, language, mode };
    runSnapshot.current = executionSnapshot;
    setFreshRun(false); setContinuedRunId(null); setComplete(false); setRunning(true); setEvents([]); setResult(null); setCursor(-1); setSelectedNode(''); setPlaying(false); setSaved(false); setSaveError(''); setPanel('compare'); setIntroOpen(false);
    try {
      const outcome = await runCode({ code, language, mode, lessonId: lesson.id, signal: controller.current.signal, onEvent: event => { if (mounted.current && token === generation.current) setEvents(current => [...current, event]); } });
      const progressSaved = recordLessonRun(lesson.id, outcome, { language: executionSnapshot.language, mode: executionSnapshot.mode });
      if (mounted.current && token === generation.current) {
        setFreshRun(true); setResult(outcome); setEvents(outcome.events); setCursor(outcome.events.length - 1); setPlaying(false);
        setAttempts(current => [...current.filter(attempt => attempt.result.id !== outcome.id), { result: outcome, snapshot: executionSnapshot }].slice(-2));
        if (!progressSaved) setSaveError('这次运行已结束，但学习进度暂时无法保存。结果仍在这里，也可以尝试存入手记。');
      }
    } catch (e) { if (mounted.current) notify(e instanceof Error ? e.message : '这次实验没有完成，请再试一次。'); }
    finally { if (mounted.current && token === generation.current) setRunning(false); }
  }
  useEffect(() => { const handler = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void run(); } if (e.key === 'Escape' && presenting) setPresenting(false); }; window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler); });
  function switchLanguage(next: Language) { if (running || replay) return; updateLanguage(next); setLanguage(next); setCode(getDraft(lesson.id, next, lesson.starter[next])); }
  function storeRun() {
    if (!result) return;
    const entry: SavedRun = { ...result, ...runSnapshot.current, lessonId: lesson.id, savedAt: Date.now(), title: lesson.title };
    if (saveRun(entry)) { setSaved(true); setSaveError(''); notify('运行快照已保存。'); } else setSaveError('浏览器暂时无法保存这次实验。请释放存储空间后重试，当前代码和结果仍留在这里。');
  }
  function finishLesson() {
    if (!canComplete || !result) return;
    const entry: SavedRun = { ...result, ...runSnapshot.current, lessonId: lesson.id, savedAt: Date.now(), title: lesson.title };
    if (!saveRun(entry)) {
      setSaveError('运行快照保存失败，因此暂未标记完成。请释放浏览器存储空间后重试，代码和结果不会在这里消失。');
      return;
    }
    setSaved(true);
    completeLesson(lesson.id);
    setLearning(readLearningState(lesson.id));
    if (!getCompleted().includes(lesson.id)) {
      setSaveError('运行记录已存入手记，但完成标记保存失败。请释放存储空间，再点击完成本章。');
      return;
    }
    setSaveError(''); setComplete(true); setPanel('learning'); setScrollTarget('completion');
  }
  function revisitPrediction() {
    setIntroOpen(true);
    setPanel('learning');
    setScrollTarget('prediction');
  }
  function resume() { setFreshRun(false); setContinuedRunId(null); setReplay(false); setSearch({}); setPlaying(false); setCursor(events.length - 1); setSaved(false); }
  async function changeMode(next: RunMode) {
    if (next === 'live') {
      try { const status = await fetch('/api/status').then(r => r.json()); if (!status.configured) { onConnect(); return; } } catch { onConnect(); return; }
    }
    setMode(next);
  }
  const effectiveCursor = running ? events.length - 1 : cursor;
  const currentEvent = events[effectiveCursor];
  const visibleEvents = events.slice(0, effectiveCursor + 1);
  const nodeId = selectedNode || currentEvent?.nodeId || '';
  const node = lesson.nodes.find(item => item.id === nodeId);
  const nodeEvent = selectedNode ? [...visibleEvents].reverse().find(item => item.nodeId === selectedNode) : currentEvent;
  const outputEvent = [...visibleEvents].reverse().find(item => item.type === 'output');
  const nextLesson = lessons[lessons.findIndex(item => item.id === lesson.id) + 1];
  const validation = validateLessonRun(lesson.id, result);
  const resultMode = result || running ? runSnapshot.current.mode : mode;
  const changedSinceRun = !!result && (code !== runSnapshot.current.code || language !== runSnapshot.current.language || mode !== runSnapshot.current.mode);
  const predictionReady = prediction !== null && (prediction === lesson.prediction.correct || understandingConfirmed);
  const canComplete = validation.passed && !replay && !running && (freshRun || continuedRunId === result?.id) && !changedSinceRun;
  const mapPath = `/explore?at=${encodeURIComponent(lesson.id)}`;
  const scene = learning.principle?.sceneId ?? ({ 'first-call': 'api-call', context: 'context', tools: 'tools', 'agent-loop': 'agent' } as Record<string, string>)[lesson.id] ?? 'api-call';
  const returnTo = `/lab/${lesson.id}${replayId ? `?replay=${encodeURIComponent(replayId)}` : ''}`;
  const theaterPath = `/theater?${new URLSearchParams({ scene, returnTo }).toString()}`;
  const continuePrinciplePath = `/theater?${new URLSearchParams({ scene, returnTo, resume: 'unseen' }).toString()}`;
  const remainingPrincipleCount = learning.principle?.remainingFrameIds.length ?? 0;
  const lastAttempt = learning.practice.lastRun;
  const practiceLabel = learning.practice.passed ? '实验已通过'
    : lastAttempt?.status === 'failed' ? '已运行 · 需要修正'
      : lastAttempt?.status === 'cancelled' ? '已运行 · 已停止'
        : learning.practice.hasRun ? '已运行 · 尚未通过' : '还没有运行';
  const latestAttempt = attempts.at(-1);
  const previousAttempt = running ? latestAttempt : attempts.length > 1 ? attempts.at(-2) : latestAttempt;
  const comparedAttempt = running ? undefined : attempts.length > 1 ? latestAttempt : undefined;
  const comparisonChanged = !!previousAttempt && !!comparedAttempt && previousAttempt.snapshot.code !== comparedAttempt.snapshot.code;
  const conditionsChanged = !!previousAttempt && !!comparedAttempt && (previousAttempt.snapshot.mode !== comparedAttempt.snapshot.mode || previousAttempt.snapshot.language !== comparedAttempt.snapshot.language);
  const baselineNeedsRepair = attempts.length === 1 && !validateLessonRun(lesson.id, attempts[0].result).passed;
  const learningStep = !attempts.length || baselineNeedsRepair ? 0 : changedSinceRun ? 2 : comparisonChanged && !conditionsChanged ? 3 : 1;
  const taskText = !attempts.length ? '先保持代码不变，运行一次。右侧会保留实际输入和输出，作为对照基线。'
    : baselineNeedsRepair ? '第一次运行还没有形成有效基线。先检查错误、模型调用和输出，修正后重跑，再开始改变量对照。'
    : changedSinceRun ? '改动还没有执行。点击“再次运行”，把新结果与上一次真实运行并排比较。'
      : comparisonChanged && !conditionsChanged ? '两次代码已不同。先核对实际输入，再比较输出；说明哪一处变化造成了什么影响。'
        : journey?.change ?? lesson.challenge.description;
  const openPrinciple = (path: string) => {
    if (rememberExperiment()) navigate(path);
    else setSaveError('暂时无法保留实验，请先保存快照再离开。');
  };
  const comparisonNote = !attempts.length ? '先建立基线。这里只显示你实际执行过的输入与输出。'
    : running ? '正在运行新代码。左侧保留最近一次记录，右侧等待新结果。'
      : baselineNeedsRepair ? '第一次运行尚未通过。保留这份失败或不完整的记录，先修正基线。'
        : attempts.length === 1 ? '基线已记录。按照操作任务改一处，再运行一次。'
          : conditionsChanged ? '两次语言或模型模式不同，不能把结果差异只归因于代码改动。'
            : !comparisonChanged ? '这两次代码相同。它们是重复运行，还没有验证“改一处”的影响。'
              : '这两次使用同一语言与模式。请继续核对输入是否只改变了目标变量。';
  const comparisonContent = <div className="lab-comparison">
    {replay ? <Empty description="历史回放没有加入这组对照。"><Button onClick={() => setPanel('flow')}>查看这条记录的执行过程</Button></Empty> : <>
      <Typography.Paragraph type="secondary" className="lab-comparison-note">{comparisonNote}</Typography.Paragraph>
      <div className="lab-comparison-grid">
        <AttemptEvidence attempt={previousAttempt} label={attempts.length <= 1 && !running ? '基线运行' : '上一次运行'} pending={running ? '基线正在运行，尚无已完成的记录。' : '先运行左侧代码，建立第一份结果。'} stale={!comparedAttempt && !running && changedSinceRun}/>
        <AttemptEvidence attempt={comparedAttempt} label="本次运行" pending={running ? '本次正在执行，尚无新结果。' : attempts.length ? '只改一处，再次运行。新结果会显示在这里。' : '有了基线之后，再修改一个变量。'} stale={changedSinceRun}/>
      </div>
      {journey && <Collapse className="lab-observe" ghost defaultActiveKey={!attempts.length ? ['observe'] : []} items={[{ key: 'observe', label: '对照时看什么？', children: <Flex vertical gap={12}>{journey.observe.map((point, index) => <Typography.Paragraph key={point}>{index + 1}. {point}</Typography.Paragraph>)}</Flex> }]}/>}
    </>}
  </div>;
  const diagramNodes = lesson.nodes.map(item => {
    const state = nodeExecutionState(visibleEvents, item.id);
    const graphState: 'idle' | 'active' | 'done' | 'error' = state === 'completed' ? 'done' : state === 'running' ? 'active' : state === 'failed' ? 'error' : 'idle';
    return { id: item.id, title: item.title, state: graphState, subtitle: state === 'completed' ? '完成' : state === 'running' ? '运行中' : state === 'failed' ? '失败' : state === 'cancelled' ? '已停止' : '待执行' };
  });
  const diagramEdges = [
    ...lesson.nodes.slice(1).map((item, index) => ({ source: lesson.nodes[index].id, target: item.id })),
    ...(lesson.id === 'agent-loop' ? [{ source: 'tool', target: 'model', label: '工具结果进入下一轮', dashed: true }] : []),
  ];
  const flowContent = <Flex vertical gap={16}>
    <Space wrap><Typography.Text type="secondary">{resultMode === 'demo' ? '代码实际执行 · 模型响应为教学模拟' : '代码实际执行 · 真实模型 API'}</Typography.Text>{changedSinceRun && <Tag color="warning">修改前运行记录</Tag>}</Space>
    <LearningDiagram nodes={diagramNodes} edges={diagramEdges} height={230} nodeWidth={132} selectedId={nodeId} onSelect={id => setSelectedNode(selectedNode === id ? '' : id)} controls ariaLabel="实验真实执行节点图"/>
    {lesson.id === 'agent-loop' && <Space wrap><Tag>{visibleEvents.filter(event => event.type === 'model.started').length} 次模型调用</Tag><Tag>{visibleEvents.filter(event => event.type === 'tool.completed').length} 次工具完成</Tag></Space>}
    <Card size="small" className="lab-event-inspector" title={nodeEvent ? nodeEvent.title : '输入与输出'} extra={<Typography.Text type="secondary">{nodeEvent ? `事件 ${nodeEvent.seq}` : '运行后可查看'}</Typography.Text>}>
      {nodeEvent ? <pre className="lab-evidence-code">{formatData(nodeEvent.data)}</pre> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="运行后点击节点，查看实际输入、返回值和对应代码。"/>}
    </Card>
    <Typography.Text type="secondary">展示应用执行记录，不代表模型内部思维。</Typography.Text>
  </Flex>;
  const principleContent = <Flex vertical gap={16}>
    <Alert showIcon type="info" title="分步查看原理" description={`${learning.principle ? `已浏览 ${learning.principle.viewedCount} / ${learning.principle.totalCount} 步。` : ''}改变参数，观察每一步的结果。`} action={<Button data-testid="principle-panel-link" disabled={running} onClick={() => openPrinciple(continuePrinciplePath)}>打开原理演示</Button>}/>
    <Collapse defaultActiveKey={['concept-0']} items={lesson.concept.map((item, index) => ({ key: `concept-${index}`, label: item.title, children: <Typography.Paragraph>{item.body}</Typography.Paragraph> }))}/>
    <Typography.Paragraph type="secondary">{lesson.takeaway}</Typography.Paragraph>
  </Flex>;
  const runStatus = running ? <Space><Spin size="small"/><Typography.Text>运行中</Typography.Text></Space> : <Tag color={result?.status === 'failed' ? 'error' : result?.status === 'cancelled' ? 'warning' : result ? 'processing' : undefined}>{result ? result.status === 'completed' ? playing ? '历史事件播放中' : '执行结束' : result.status === 'cancelled' ? '已停止' : '运行失败' : '等待运行'}</Tag>;
  const completionReason = canComplete ? '当前代码满足本节的运行证据要求。保存实验后，继续用对照结果解释输入如何影响输出。'
    : replay ? '历史回放不能作为新的完成记录。继续编辑并重新运行后验证。'
      : changedSinceRun ? '代码或模式已改变。当前是旧结果，请重新运行后记录。'
        : result && !validation.passed ? validation.reason : '完成一次有效的模型调用与输出后，才能保存本节通过记录。';
  const outputContent = <Flex vertical gap={16}>
    <Card className="lab-trace" size="small" title={<Space><Film size={16}/><Typography.Text>执行记录</Typography.Text><Tag>{events.length} 个事件</Tag></Space>} extra={<Space>
      <Button data-testid="play-record" disabled={!result || !events.length || running} icon={playing ? <Pause size={16}/> : <Play size={16}/>} onClick={() => { setSelectedNode(''); if (effectiveCursor >= events.length - 1) setCursor(0); setPlaying(!playing); }}>{playing ? '暂停回放' : '播放记录'}</Button>
    </Space>}>
      {events.length > 0 ? <Flex className="lab-timeline" align="center" gap={18}><Slider style={{ flex: 1 }} min={0} max={Math.max(0, events.length - 1)} value={Math.max(0, effectiveCursor)} disabled={running} ariaLabelForHandle="执行事件回放位置" tooltip={{ formatter: value => `事件 ${(value ?? 0) + 1}` }} onChange={value => { setCursor(value); setPlaying(false); setSelectedNode(''); }}/><Typography.Text className="event-counter">{effectiveCursor + 1} / {events.length}</Typography.Text></Flex> : <Typography.Text type="secondary">模型调用、工具执行和输出会记录在这里。回放不会重新请求 API。</Typography.Text>}
    </Card>
    {(outputEvent || result?.error) && <Card className="lab-output" size="small" title={<Space><Terminal size={16}/>{changedSinceRun ? '修改前运行的输出' : replay ? '历史运行输出' : result?.status === 'failed' ? '运行错误' : result?.status === 'cancelled' ? '停止信息' : '最终输出'}</Space>} extra={<Typography.Text type="secondary">{result ? `${(result.duration / 1000).toFixed(2)} s` : ''}</Typography.Text>}>
      {result?.error ? <Alert type={result.status === 'failed' ? 'error' : 'warning'} showIcon title={readableError(result.error)}/> : <pre className="lab-evidence-code">{formatData(outputEvent?.data)}</pre>}
      {result?.status === 'failed' && result.error && <Collapse ghost items={[{ key: 'error', label: '完整错误信息', children: <pre className="lab-evidence-code">{result.error}</pre> }]}/>}
    </Card>}
    {!outputEvent && !result?.error && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={result ? '当前回放位置还没有最终输出。拖动执行滑块查看后续事件。' : '运行代码后，可在这里查看执行记录与最终输出。'}/>}
  </Flex>;
  const learningContent = <Flex vertical gap={16}>
    <Typography.Paragraph type="secondary">{journey?.scenario ?? lesson.description}</Typography.Paragraph>
    {replay ? <Alert type="info" showIcon title="正在查看历史运行" description="回放不会加入本人的两次实验对照；继续编辑并实际运行后，才能建立新的比较。"/> : <Card className="lab-method" size="small" aria-label="本节实验步骤">
      <Steps size="small" current={learningStep} responsive={false} items={['先跑一次', '只改一处', '再跑对比', '解释结果'].map(title => ({ title }))}/>
      <div className="lab-current-task"><Typography.Text strong>{running ? '正在执行' : learningStep === 0 ? '建立基线' : learningStep === 3 ? '对照证据' : '本次操作'}</Typography.Text><Typography.Paragraph>{running ? '等待本次代码的输入与结果。已有记录会保留，不会冒充新输出。' : taskText}</Typography.Paragraph></div>
      {journey && <Collapse ghost size="small" items={[{ key: 'why', label: '为什么做这个实验？', children: <Typography.Paragraph>{journey.why}</Typography.Paragraph> }]}/>}
    </Card>}
    {!replay && <Card className="lab-explain" title="4 · 解释结果">
      <Typography.Title level={5}>改了什么？哪条执行记录能说明原因？</Typography.Title><Typography.Paragraph>{journey?.takeaway ?? lesson.takeaway}</Typography.Paragraph>
      {journey && <Typography.Paragraph type="secondary"><Space align="start"><Code2 size={17}/><span>带回学习助手：{journey.projectContribution}</span></Space></Typography.Paragraph>}
      <div id={`prediction-${lesson.id}`}><Collapse className="lab-prediction" activeKey={introOpen ? ['check'] : []} onChange={keys => setIntroOpen(keys.includes('check'))} items={[{ key: 'check', label: <Space><BookOpen size={16}/>{predictionReady ? '理解自查 · 已查看解释' : '用一个问题检查自己的解释'}</Space>, children: <Flex vertical gap={16}>
        <Typography.Paragraph>{lesson.prediction.question}</Typography.Paragraph>
        <Radio.Group value={prediction} onChange={event => { setPrediction(event.target.value as number); setUnderstandingConfirmed(false); }}><Flex vertical gap={12}>{lesson.prediction.options.map((option, index) => <Radio key={option} value={index}>{String.fromCharCode(65 + index)}. {option}</Radio>)}</Flex></Radio.Group>
        {prediction !== null && <Alert className="prediction-feedback" type="info" showIcon title={prediction === lesson.prediction.correct ? '这个判断与执行机制一致。' : '回到输入和执行记录，检查这个区别。'} description={lesson.prediction.explanation} action={<Button onClick={() => { setUnderstandingConfirmed(true); setIntroOpen(false); }}>看过解释，继续对照</Button>}/>}
        <Typography.Text type="secondary">自查帮助你解释现象；选项不会锁住实验，也不会替代运行证据。</Typography.Text>
      </Flex> }]}/></div>
    </Card>}
    <Collapse className="lab-challenge" items={[{ key: 'challenge', label: `进阶验证 · ${lesson.challenge.title}`, children: <Flex vertical gap={12}><Typography.Paragraph>{lesson.challenge.description}</Typography.Paragraph><Button onClick={() => setHint(!hint)}>{hint ? '隐藏提示' : '查看提示'}</Button>{hint && <Alert type="info" showIcon title={lesson.challenge.hint}/>}</Flex> }]}/>
    <Card className="lab-completion-check" title="记录实验">
      <Typography.Paragraph>{completionReason}</Typography.Paragraph>{!replay && !predictionReady && <Button type="link" icon={<BookOpen size={16}/>} onClick={revisitPrediction}>解释结果时，可以用这道题自查</Button>}
    </Card>
    {complete && <Alert id={`completion-${lesson.id}`} className="lab-completed-message" role="status" type="success" showIcon closable={{ onClose: () => setComplete(false) }} title="实验通过记录和运行证据已保存。" description={<Flex vertical gap={12}><Typography.Paragraph>{journey?.projectContribution ?? lesson.takeaway} 原理已浏览 {learning.principle?.viewedCount ?? 0} / {learning.principle?.totalCount ?? 0} 步；运行通过不等同于理解全部原理。</Typography.Paragraph><Space wrap><Button onClick={() => navigate(mapPath)}>返回学习路径</Button><Button onClick={() => navigate('/notebook')}>查看运行快照</Button>{nextLesson?.available && <Button type="primary" onClick={() => navigate(`/lab/${nextLesson.id}`)}>继续：{nextLesson.subtitle}</Button>}</Space></Flex>}/>}
  </Flex>;
  const scrollPane = (key: ObservationPanel, label: string, content: ReactNode) => <div
    ref={element => { if (element) panelScrollRefs.current[key] = element; else delete panelScrollRefs.current[key]; }}
    className="lab-panel-scroll" data-scroll-region={key} role="region" aria-label={`${label}，独立滚动区域`} tabIndex={0}
  >{content}</div>;
  return <div className={`developer-lab experiment-page ${presenting ? 'is-presenting' : ''}`}>
    {messageContext}
    <header className="lab-fixed-heading">
      <Flex className="lab-context-row" justify="space-between" align="center" gap={16}>
        <Breadcrumb items={[{ title: <Link to={mapPath}><Space><ArrowLeft size={15}/>学习路径</Space></Link> }, { title: `${lesson.number} · ${learning.title || lesson.subtitle}` }]}/>
        <Space>{replay && <Tag className="replay-pill">历史回放 · 无新增请求</Tag>}<Button icon={<BookOpen size={16}/>} onClick={() => setPanel('learning')}>学习任务</Button><Button icon={<Maximize2 size={16}/>} onClick={() => setPresenting(!presenting)}>{presenting ? '退出讲解' : '讲解模式'}</Button></Space>
      </Flex>
      <Flex className="lab-heading-row" justify="space-between" align="center" gap={16}>
        <Typography.Title level={4} className="lab-lesson-question" ellipsis={{ tooltip: journey?.question ?? learning.objective }}>{journey?.question ?? learning.objective}</Typography.Title>
        <Space className="lab-progress-line" size={8} aria-label="本章学习进度">
          <Film size={15}/><Tag>{learning.principle ? `${learning.principle.viewedCount} / ${learning.principle.totalCount} 步` : '待开放'}</Tag>
          {learning.principle && <Button type="link" size="small" data-testid="principle-link" disabled={running} onClick={() => openPrinciple(remainingPrincipleCount ? continuePrinciplePath : theaterPath)}>{remainingPrincipleCount ? '浏览原理' : '重看原理'}</Button>}
          <Tag color={learning.practice.passed ? 'success' : lastAttempt?.status === 'failed' ? 'error' : undefined}>{running ? '运行中' : practiceLabel}</Tag>
          {learning.practice.passed && lastAttempt && !lastAttempt.passed && <Tag color="warning">最近一次{lastAttempt.status === 'cancelled' ? '已停止' : '未通过'}</Tag>}
        </Space>
      </Flex>
      {!replay && <Flex className="lab-task-strip" align="center" gap={10}><Tag color="processing">{['1 · 先跑一次', '2 · 只改一处', '3 · 再跑对比', '4 · 解释结果'][learningStep]}</Tag><Typography.Paragraph className="lab-task-summary" ellipsis={{ rows: 1, tooltip: taskText }}>{taskText}</Typography.Paragraph><Button type="link" size="small" onClick={() => setPanel('learning')}>任务详情</Button></Flex>}
    </header>
    <div className="lab-workbench">
      <Card className="lab-code-panel" aria-label="代码编辑区域" title={<Space><Code2 size={17}/><Typography.Text code>experiment.{language === 'python' ? 'py' : language === 'typescript' ? 'ts' : 'js'}</Typography.Text></Space>} extra={<Space>
        <Select<Language> aria-label="编程语言" value={language} onChange={switchLanguage} disabled={running || replay} style={{ width: 135 }} options={[{ value: 'typescript', label: 'TypeScript' }, { value: 'javascript', label: 'JavaScript' }, { value: 'python', label: 'Python' }]}/>
        <Tooltip title="恢复初始代码"><Button icon={<RotateCcw size={16}/>} disabled={running || replay} aria-label="恢复初始代码" onClick={() => { setCode(lesson.starter[language]); notify('已恢复初始代码'); }}/></Tooltip>
      </Space>} classNames={{ body: 'lab-code-body' }}>
        <Flex className="lab-run-toolbar" justify="space-between" align="center" gap={12}>
          <Segmented<RunMode> value={mode} disabled={running || replay} onChange={next => void changeMode(next)} options={[{ label: '教学模拟', value: 'demo' }, { label: '真实 API', value: 'live' }]}/>
          {replay ? <Button type="primary" data-testid="resume-editing" icon={<Code2 size={16}/>} onClick={resume}>继续编辑</Button> : running ? <Button type="primary" danger data-testid="stop-experiment" icon={<Square size={15}/>} onClick={() => controller.current?.abort()}>停止实验</Button> : <Tooltip title="⌘ / Ctrl + Enter"><Button type="primary" data-testid="run-experiment" icon={<Play size={16}/>} onClick={() => void run()}>{attempts.length ? '再次运行' : '运行，建立基线'}</Button></Tooltip>}
        </Flex>
        <div className="lab-editor" role="region" aria-label="代码，独立滚动区域"><CodeEditor code={code} language={language} onChange={setCode} reveal={node?.codeMatch} readOnly={running || replay}/></div>
      </Card>
      <Card className="lab-observation-panel" aria-label="实验观察区域" classNames={{ body: 'lab-observation-body' }}>
        <Tabs className="lab-observation-tabs" activeKey={panel} onChange={key => setPanel(key as ObservationPanel)} tabBarExtraContent={runStatus} items={[
          { key: 'compare', label: '对比', children: scrollPane('compare', '运行对比', comparisonContent) },
          { key: 'flow', label: '执行', children: scrollPane('flow', '执行过程', flowContent) },
          { key: 'output', label: '输出', children: scrollPane('output', '执行记录与输出', outputContent) },
          { key: 'principle', label: '原理', children: scrollPane('principle', '原理说明', principleContent) },
          { key: 'learning', label: '任务', children: scrollPane('learning', '学习任务与完成记录', learningContent) },
        ]}/>
        <div className="lab-observation-footer">
          {saveError && <Alert className="workspace-save-error" role="alert" type="error" showIcon title="保存未完成" description={saveError}/>}
          <Flex justify="space-between" align="center" gap={8}>
            <Typography.Text className="lab-evidence-status" type="secondary">{changedSinceRun ? '代码已修改 · 当前是旧证据' : continuedRunId && !freshRun && !replay ? '已恢复运行 · 未重新请求' : replay ? '只读历史记录' : result ? `本次 ${events.length} 个事件` : '等待实际运行'}</Typography.Text>
            <Space><Button data-testid="save-run" disabled={!result || saved || running} icon={saved ? <Check size={16}/> : <Save size={16}/>} onClick={storeRun}>{saved ? '快照已保存' : '保存快照'}</Button><Button type="primary" data-testid="complete-experiment" disabled={!canComplete} icon={<Check size={16}/>} onClick={finishLesson}>保存进度</Button></Space>
          </Flex>
          {result && !canComplete && <Button type="link" size="small" onClick={() => setPanel('learning')}>查看验证说明</Button>}
        </div>
      </Card>
    </div>
  </div>;
}
