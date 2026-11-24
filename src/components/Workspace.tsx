import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Alert, Button, Card, Collapse, ConfigProvider, Dropdown, Empty, Flex, message, Radio, Result, Select, Segmented, Slider, Space, Spin, Steps, Tag, Tooltip, Typography } from 'antd';
import { ArrowLeft, BookOpen, Check, Code2, Film, Maximize2, Pause, Play, RotateCcw, Save, Square, Terminal, CornerUpLeft } from 'lucide-react';
import { lessons } from '../data/lessons';
import { getAdvancedLab } from '../data/advanced-labs';
import ReadChapterFilm from './ReadChapterFilm';
import PracticeGuide from './PracticeGuide';
import { describeInputChange } from '../lib/practice-comparison';
import { getPracticeGuide } from '../data/practice-guides';
import { getChapterFilm } from '../data/chapter-films';
import { LEARNING_PATH } from '../data/learning-path';
import { chapterPath } from '../lib/chapter-navigation';
import { getLessonJourney } from '../data/journey';
import { getStoryStarter } from '../lib/tool-story';
import { chooseWorkspaceCode, parseStoryPeople } from '../lib/workspace-entry';
import { inspectExecution, locateFrameInCode, locateTeachingAnchor } from '../lib/execution-inspector';
import { runCode } from '../runtime';
import { validateLessonRun, nodeExecutionState } from '../lib/progress';
import { readLearningState, recordLessonRun, subscribeLearningState } from '../lib/learning-state';
import { completeLesson, getCompleted, getDraft, getLanguage, getRuns, saveRun, setDraft, setLanguage } from '../lib/storage';
import type { Language, Lesson, RunEvent, RunMode, RunResult, SavedRun } from '../types';
import CodeEditor from './CodeEditor';
import StepEvidence from './StepEvidence';
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

type WorkspaceProps = { onConnect: () => void; onRunningChange: (value: boolean) => void; onFrameChange: (id: string) => void };
export default function Workspace({ onConnect, onRunningChange, onFrameChange }: WorkspaceProps) {
  const { lessonId } = useParams();
  const navigate = useNavigate();
  const lesson = lessons.find(item => item.id === lessonId);
  return lesson?.available ? <Experiment key={lesson.id} lesson={lesson} onConnect={onConnect} onRunningChange={onRunningChange} onFrameChange={onFrameChange}/> : <Result status="info" title="这章的代码实验尚未开放" extra={<Button type="primary" onClick={() => navigate('/explore')}>回到学习路径</Button>}/>;
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
      <Typography.Paragraph type="secondary" className="lab-attempt-meta">{attempt.snapshot.language} · {inputs.length ? attempt.snapshot.mode === 'demo' ? '教学模拟' : '真实 API' : '本地执行'} · {attempt.result.id.slice(0, 8)}</Typography.Paragraph>
      {stale && <Alert className="lab-stale-evidence" type="warning" showIcon title="代码已修改，下面仍是修改前的结果。"/>}
      <div className="lab-attempt-value"><Typography.Text type="secondary">{preparedInputs.length ? '输入步骤记录' : '实际模型输入'}</Typography.Text><pre>{displayedInputs.length ? formatData(displayedInputs.length === 1 ? displayedInputs[0] : displayedInputs) : '本次没有输入步骤或模型调用。'}</pre></div>
      <div className="lab-attempt-value"><Typography.Text type="secondary">{attempt.result.error ? '错误 / 停止原因' : '实际输出'}</Typography.Text><pre>{attempt.result.error ? readableError(attempt.result.error) : outputs.length ? formatData(outputs.length === 1 ? outputs[0] : outputs) : '本次没有 lab.output 输出。'}</pre></div>
      <Collapse size="small" ghost items={[
        ...(inputs.length > 0 ? [{ key: 'requests', label: `模型实际收到什么？ · ${inputs.length} 次调用`, children: <pre className="lab-evidence-code">{inputs.length ? formatData(inputs.length === 1 ? inputs[0] : inputs) : '本次没有发起模型调用。'}</pre> }] : []),
        { key: 'source', label: '查看这次运行的代码', children: <pre className="lab-evidence-code">{attempt.snapshot.code}</pre> },
      ]}/>
    </> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={pending}/>}
  </Card>;
}

function Experiment({ lesson, onConnect, onRunningChange, onFrameChange }: WorkspaceProps & { lesson: Lesson }) {
  const journey = getLessonJourney(lesson.id);
  const localLab = getAdvancedLab(lesson.id);
  const usesModel = !localLab;
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const replayId = search.get('replay');
  const fromStory = lesson.id === 'tools' && search.get('entry') === 'story';
  const storyPeople = fromStory ? parseStoryPeople(search.get('people')) : null;
  const [restored] = useState(() => replayId ? null : restoreExperiment(lesson.id));
  const [learning, setLearning] = useState(() => readLearningState(lesson.id));
  const [language, updateLanguage] = useState<Language>(() => restored?.language ?? getLanguage());
  const [code, setCode] = useState(() => {
    const initialLanguage = restored?.language ?? getLanguage();
    return chooseWorkspaceCode({ language: initialLanguage, draft: getDraft(lesson.id, initialLanguage, lesson.starter[initialLanguage]), defaultCode: lesson.starter[initialLanguage], storyPeople, replay: !!replayId });
  });
  const [mode, setMode] = useState<RunMode>(restored?.mode ?? 'demo');
  const [running, setRunning] = useState(false);
  useEffect(() => { onRunningChange(running); return () => onRunningChange(false); }, [running, onRunningChange]);
  const [events, setEvents] = useState<RunEvent[]>(restored?.result?.events ?? []);
  const [result, setResult] = useState<RunResult | null>(restored?.result ?? null);
  const [attempts, setAttempts] = useState<ExecutedAttempt[]>(restored?.attempts ?? []);
  const [prediction, setPrediction] = useState<number | null>(restored?.prediction ?? null);
  const [understandingConfirmed, setUnderstandingConfirmed] = useState(restored?.understandingConfirmed === true);
  const [introOpen, setIntroOpen] = useState(false);
  const [panel, setPanel] = useState<ObservationPanel>('flow');
  const guide = getPracticeGuide(lesson.id);
  const film = getChapterFilm(lesson.id);
  const routeFrame = film?.frames.find(frame => frame.id === search.get('frame'))?.id;
  const [frameId, setFrameId] = useState(routeFrame);
  const [sourceFocus, setSourceFocus] = useState<'execution' | 'frame' | 'edit'>(routeFrame && !replayId ? 'frame' : 'execution');
  const [selectedNode, setSelectedNode] = useState('');
  useEffect(() => {
    setFrameId(routeFrame);
    if (routeFrame) onFrameChange(routeFrame);
    setSourceFocus(routeFrame && !replayId ? 'frame' : 'execution');
    setSelectedNode('');
  }, [routeFrame, replayId, onFrameChange]);
  const followFrame = useCallback((id: string) => {
    setFrameId(id);
    setSourceFocus('frame');
    onFrameChange(id);
  }, [onFrameChange]);
  const [selectionVersion, setSelectionVersion] = useState(0);
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
  useEffect(() => { if (running) panelScrollRefs.current.flow?.scrollTo({ top: 0 }); }, [running]);
  async function run() {
    if (running || replay) return;
    setSourceFocus('execution');
    const token = ++generation.current;
    controller.current = new AbortController();
    const executionSnapshot = { code, language, mode };
    runSnapshot.current = executionSnapshot;
    setFreshRun(false); setContinuedRunId(null); setComplete(false); setRunning(true); setEvents([]); setResult(null); setCursor(-1); setSelectedNode(''); setPlaying(false); setSaved(false); setSaveError(''); setPanel('flow'); setIntroOpen(false);
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
  function switchLanguage(next: Language) {
    if (running || replay) return;
    updateLanguage(next); setLanguage(next);
    setCode(chooseWorkspaceCode({ language: next, draft: getDraft(lesson.id, next, lesson.starter[next]), defaultCode: lesson.starter[next], storyPeople, replay }));
  }
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
  const frameGuide = frameId ? guide?.frames[frameId] : undefined;
  const frameFocus = sourceFocus === 'frame' && frameGuide;
  const nodeId = frameFocus ? frameGuide.nodeId : selectedNode || currentEvent?.nodeId || 'input';
  const node = lesson.nodes.find(item => item.id === nodeId);
  const outputEvent = [...visibleEvents].reverse().find(item => item.type === 'output');
  const nextLesson = LEARNING_PATH[LEARNING_PATH.findIndex(item => item.lessonId === lesson.id) + 1];
  const validation = validateLessonRun(lesson.id, result);
  const resultMode = result || running ? runSnapshot.current.mode : mode;
  const changedSinceRun = !!result && (code !== runSnapshot.current.code || language !== runSnapshot.current.language || mode !== runSnapshot.current.mode);
  const inspection = inspectExecution({ lessonId: lesson.id, nodeId, localSteps: !usesModel, nodeDescription: node?.subtitle, events: visibleEvents, code, language, matchesSnapshot: !changedSinceRun });
  const editLine = locateTeachingAnchor(code, language, guide?.editAnchor?.[language]);
  // Film associations describe source in the current editor, independently of any past run.
  const frameLine = frameFocus ? locateFrameInCode(code, language, frameGuide) : null;
  const editorLocation = sourceFocus === 'edit' ? editLine : frameFocus ? frameLine :
    events.length || selectedNode ? inspection.location : null;
  const revealKey = sourceFocus === 'edit' ? 'edit:' + selectionVersion + ':' + language :
    frameFocus ? 'frame:' + frameId + ':' + language : events.length || selectedNode ?
      nodeId + ':' + (inspection.event?.id ?? '') + ':' + selectionVersion + ':' + language : undefined;
  function selectExecutionStep(id: string) {
    setSourceFocus('execution');
    setSelectedNode(id);
    setSelectionVersion(version => version + 1);
    const related = film?.frames.find(item => guide?.frames[item.id]?.nodeId === id);
    if (related) { setFrameId(related.id); onFrameChange(related.id); }
  }
  function showFilm() {
    const related = film?.frames.find(item => guide?.frames[item.id]?.nodeId === nodeId);
    if (sourceFocus === 'execution' && related) setFrameId(related.id);
    setPanel('principle');
  }
  const predictionReady = prediction !== null && (prediction === lesson.prediction.correct || understandingConfirmed);
  const canComplete = validation.passed && !replay && !running && (freshRun || continuedRunId === result?.id) && !changedSinceRun;
  const mapPath = `/explore?at=${encodeURIComponent(lesson.id)}`;
  const lastAttempt = learning.practice.lastRun;
  const practiceLabel = learning.practice.passSource === 'legacy-completed' ? '代码待验证' : learning.practice.passed ? '实验已通过'
    : lastAttempt?.status === 'failed' ? '已运行 · 需要修正'
      : lastAttempt?.status === 'cancelled' ? '已运行 · 已停止'
        : learning.practice.hasRun ? '已运行 · 尚未通过' : '还没有运行';
  const latestAttempt = attempts.at(-1);
  const previousAttempt = running ? latestAttempt : attempts.length > 1 ? attempts.at(-2) : latestAttempt;
  const comparedAttempt = running ? undefined : attempts.length > 1 ? latestAttempt : undefined;
  const comparisonChanged = !!previousAttempt && !!comparedAttempt && previousAttempt.snapshot.code !== comparedAttempt.snapshot.code;
  const conditionsChanged = !!previousAttempt && !!comparedAttempt && (previousAttempt.snapshot.mode !== comparedAttempt.snapshot.mode || previousAttempt.snapshot.language !== comparedAttempt.snapshot.language);
  const toolPreparedInput = latestAttempt?.result.events.filter(event => event.type === 'step' && event.nodeId === 'input' && event.title === '准备费用问题').at(-1)?.data;
  const toolPeople = toolPreparedInput && typeof toolPreparedInput === 'object' && 'people' in toolPreparedInput && typeof toolPreparedInput.people === 'number' && Number.isInteger(toolPreparedInput.people) && toolPreparedInput.people >= 1 && toolPreparedInput.people <= 99 ? toolPreparedInput.people : null;
  const changeTask = lesson.id === 'tools'
    ? toolPeople === null ? '只改变人数 people，保持单价 price 和工具执行代码不变，再运行比较实际输入与结果。' : `最近一次实际人数是 ${toolPeople}。只把 people 改成 ${toolPeople === 19 ? 17 : 19}，保持 price 与工具执行代码不变。`
    : journey?.change ?? lesson.challenge.description;
  const observationPoints = lesson.id === 'tools' ? [
    '对照两次“准备费用问题”的实际人数与单价，确认只改了人数。',
    '核对每次 calculator 的 expression 和返回结果，检查总费用是否随人数变化。',
    '最终输出应与那次工具返回值一致；若不一致，沿模型请求、工具输入和输出定位。',
  ] : journey?.observe ?? [];
  const baselineNeedsRepair = attempts.length === 1 && !validateLessonRun(lesson.id, attempts[0].result).passed;
  const learningStep = !attempts.length || baselineNeedsRepair ? 0 : changedSinceRun ? 2 : comparisonChanged && !conditionsChanged ? 3 : 1;
  const taskText = !attempts.length ? '先保持代码不变，运行一次。右侧会保留实际输入和输出，作为对照基线。'
    : baselineNeedsRepair ? '第一次运行还没有形成有效基线。先检查错误、执行步骤和输出，修正后重跑，再开始改变量对照。'
    : changedSinceRun ? '改动还没有执行。点击“再次运行”，把新结果与上一次真实运行并排比较。'
      : comparisonChanged && !conditionsChanged ? '两次代码已不同。先核对实际输入，再比较输出；说明哪一处变化造成了什么影响。'
        : changeTask;
  const inputChange = previousAttempt && comparedAttempt ? describeInputChange(previousAttempt.result.events, comparedAttempt.result.events) : undefined;
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
      {inputChange && <p className="lab-input-change"><strong>两次记录的输入</strong> {inputChange}</p>}
      <div className="lab-comparison-grid">
        <AttemptEvidence attempt={previousAttempt} label={attempts.length <= 1 && !running ? '基线运行' : '上一次运行'} pending={running ? '基线正在运行，尚无已完成的记录。' : '先运行左侧代码，建立第一份结果。'} stale={!comparedAttempt && !running && changedSinceRun}/>
        <AttemptEvidence attempt={comparedAttempt} label="本次运行" pending={running ? '本次正在执行，尚无新结果。' : attempts.length ? '只改一处，再次运行。新结果会显示在这里。' : '有了基线之后，再修改一个变量。'} stale={changedSinceRun}/>
      </div>
      {journey && <Collapse className="lab-observe" ghost defaultActiveKey={!attempts.length ? ['observe'] : []} items={[{ key: 'observe', label: '对照时看什么？', children: <Flex vertical gap={12}>{observationPoints.map((point, index) => <Typography.Paragraph key={point}>{index + 1}. {point}</Typography.Paragraph>)}</Flex> }]}/>}
    </>}
  </div>;
  const executionSteps = lesson.nodes.map(item => {
    const state = nodeExecutionState(visibleEvents, item.id);
    const status: 'finish' | 'process' | 'error' | 'wait' = state === 'completed' ? 'finish' : state === 'running' ? 'process' : state === 'failed' ? 'error' : 'wait';
    const title = ({ input: '准备输入', model: '询问模型', tool: '执行工具', output: '展示结果' } as Record<string, string>)[item.id] ?? item.title;
    return { key: item.id, title: <span data-node-id={item.id}>{title}</span>, status, content: state === 'completed' ? '已完成' : state === 'running' ? '正在执行' : state === 'failed' ? '发生错误' : state === 'cancelled' ? '已停止' : '等运行', className: nodeId === item.id ? 'lab-step-selected' : undefined };
  });
  const lastToolEvent = visibleEvents.filter(event => event.type === 'tool.completed').at(-1);
  const nextModelRequest = lastToolEvent ? visibleEvents.find(event => event.type === 'model.started' && event.seq > lastToolEvent.seq) : undefined;
  const nextModelRound = nextModelRequest ? visibleEvents.filter(event => event.type === 'model.started' && event.seq <= nextModelRequest.seq).length : 0;
  const lastToolName = lastToolEvent?.data && typeof lastToolEvent.data === 'object' && 'name' in lastToolEvent.data ? String(lastToolEvent.data.name) : '工具';
  const comparisonAvailable = attempts.length >= 2 && !replay && !running;
  const twoValidRuns = comparisonAvailable && previousAttempt && comparedAttempt &&
    validateLessonRun(lesson.id, previousAttempt.result).passed && validation.passed;
  const phase = replay ? 'replay' : changedSinceRun ? 'edited' : !latestAttempt ? 'initial' :
    !validateLessonRun(lesson.id, latestAttempt.result).passed ? 'retry' :
    twoValidRuns && comparisonChanged && !conditionsChanged ? 'compared' : 'baseline';
  const lastOutput = (attempt?: ExecutedAttempt) => attempt?.result.events.filter(event => event.type === 'output').at(-1)?.data;
  const guideOutputs = phase === 'replay' ? { before: outputEvent?.data } :
    phase === 'retry' ? {} : phase === 'compared' ? { before: lastOutput(previousAttempt), after: lastOutput(comparedAttempt) } :
    { before: lastOutput(latestAttempt) };
  const flowContent = <Flex vertical gap={10}>
    {!running && <PracticeGuide lessonId={lesson.id} phase={phase} outputs={guideOutputs} inputChange={inputChange}
      editInstruction={lesson.id === 'tools' && toolPeople !== null ? changeTask : undefined}
      canLocate={!!editLine && !replay} onLocate={() => { setSourceFocus('edit'); setSelectionVersion(value => value + 1); }}
      comparisonAvailable={comparisonAvailable} onCompare={() => setPanel('compare')}
      onInspectOutput={() => setPanel('output')} onRun={replay ? undefined : () => void run()}/>}
    <div className="lab-execution-route" aria-label="实验执行步骤"><Steps className="lab-execution-steps" size="small" orientation="horizontal" titlePlacement="vertical" responsive={false} current={Math.max(0, lesson.nodes.findIndex(item => item.id === nodeId))} items={executionSteps} onChange={index => selectExecutionStep(lesson.nodes[index].id)}/></div>
    {lesson.id === 'agent-loop' && <div className="lab-agent-return" data-testid="agent-return-route"><CornerUpLeft size={20}/><div><Typography.Text strong>工具结果，交回下一轮</Typography.Text><Typography.Paragraph>{nextModelRequest ? `${lastToolName} 返回后，程序发起了第 ${nextModelRound} 次模型请求。` : lastToolEvent ? `${lastToolName} 已返回；当前记录里还没有下一次模型请求。` : '下一轮需要把工具结果放进 history，再发给模型。'}</Typography.Paragraph>{nextModelRequest && <Button type="link" size="small" disabled={running} onClick={() => { const response = events.find(event => event.type === 'model.completed' && event.seq > nextModelRequest.seq); setCursor(events.findIndex(event => event.id === (response ?? nextModelRequest).id)); setPlaying(false); selectExecutionStep('model'); }}>查看这次请求里的 history →</Button>}</div></div>}
    {changedSinceRun && <Alert type="warning" showIcon title="这是修改前的运行记录。再跑一次，才能验证新代码。"/>}
    {(events.length > 0 || selectedNode) && <div className="lab-step-explanation" aria-live="polite">
      <Flex justify="space-between" align="center" gap={12}><Typography.Title level={5}>{node?.title ?? '执行步骤'}</Typography.Title>{inspection.event && <Typography.Text type="secondary">记录 {inspection.event.seq}</Typography.Text>}</Flex>
      {(events.length > 0 || selectedNode) && <Typography.Paragraph>{inspection.explanation}</Typography.Paragraph>}
    </div>}
    {events.length > 0 && <StepEvidence nodeId={nodeId} inspection={inspection}/>}
    {events.length > 0 && <Typography.Text type={changedSinceRun ? 'warning' : 'secondary'} className="lab-code-location-note" data-testid="code-location-note">{inspection.locationNote}</Typography.Text>}
    <Typography.Text type="secondary" className="lab-model-source">{localLab && !events.some(event => event.type === 'model.started') ? localLab.boundary : resultMode === 'demo' ? '模型用教学模拟回答；代码和工具照常执行。' : '本次使用真实模型 API。'}</Typography.Text>
  </Flex>;
  const principleContent = panel === 'principle' ? <ReadChapterFilm key={lesson.id} lessonId={lesson.id} startFrameId={frameId} onFrameChange={followFrame}/> : null;
  const runStatus = running ? <Space><Spin size="small"/><Typography.Text>运行中</Typography.Text></Space> : <Tag color={result?.status === 'failed' ? 'error' : result?.status === 'cancelled' ? 'warning' : result ? 'processing' : undefined}>{result ? result.status === 'completed' ? playing ? '历史事件播放中' : '执行结束' : result.status === 'cancelled' ? '已停止' : '运行失败' : '等待运行'}</Tag>;
  const completionReason = canComplete ? '当前代码满足本节的运行证据要求。保存实验后，继续用对照结果解释输入如何影响输出。'
    : replay ? '历史回放不能作为新的完成记录。继续编辑并重新运行后验证。'
      : changedSinceRun ? '代码或模式已改变。当前是旧结果，请重新运行后记录。'
        : result && !validation.passed ? validation.reason : '运行本章代码，完成所需步骤并输出结果后，可以保存通过记录。';
  const outputContent = <Flex vertical gap={16}>
    <Card className="lab-trace" size="small" title={<Space><Film size={16}/><Typography.Text>执行记录</Typography.Text><Tag>{events.length} 个事件</Tag></Space>} extra={<Space>
      <Button data-testid="play-record" disabled={!result || !events.length || running} icon={playing ? <Pause size={16}/> : <Play size={16}/>} onClick={() => { setSourceFocus('execution'); setSelectedNode(''); if (effectiveCursor >= events.length - 1) setCursor(0); setPlaying(!playing); }}>{playing ? '暂停回放' : '播放记录'}</Button>
    </Space>}>
      {events.length > 0 ? <Flex className="lab-timeline" align="center" gap={18}><Slider style={{ flex: 1 }} min={0} max={Math.max(0, events.length - 1)} value={Math.max(0, effectiveCursor)} disabled={running} ariaLabelForHandle="执行事件回放位置" tooltip={{ formatter: value => `事件 ${(value ?? 0) + 1}` }} onChange={value => { setSourceFocus('execution'); setCursor(value); setPlaying(false); setSelectedNode(''); }}/><Typography.Text className="event-counter">{effectiveCursor + 1} / {events.length}</Typography.Text></Flex> : <Typography.Text type="secondary">这里会记录本次执行的步骤和输出。</Typography.Text>}
    </Card>
    {(outputEvent || result?.error) && <Card className="lab-output" size="small" title={<Space><Terminal size={16}/>{changedSinceRun ? '修改前运行的输出' : replay ? '历史运行输出' : result?.status === 'failed' ? '运行错误' : result?.status === 'cancelled' ? '停止信息' : '最终输出'}</Space>} extra={<Typography.Text type="secondary">{result ? `${(result.duration / 1000).toFixed(2)} s` : ''}</Typography.Text>}>
      {result?.error ? <Alert type={result.status === 'failed' ? 'error' : 'warning'} showIcon title={readableError(result.error)}/> : <pre className="lab-evidence-code">{formatData(outputEvent?.data)}</pre>}
      {result?.status === 'failed' && result.error && <Collapse ghost items={[{ key: 'error', label: '完整错误信息', children: <pre className="lab-evidence-code">{result.error}</pre> }]}/>}
    </Card>}
    {!outputEvent && !result?.error && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={result ? '当前回放位置还没有最终输出。拖动执行滑块查看后续事件。' : '运行代码后，可在这里查看执行记录与最终输出。'}/>}
  </Flex>;
  const learningContent = <Flex vertical gap={16}>
    <Typography.Paragraph type="secondary">{lesson.id === 'tools' ? '给定人数和单价，让模型提出计算器请求，再由程序执行并展示总费用。以这次输入步骤中的数据为准。' : journey?.scenario ?? lesson.description}</Typography.Paragraph>
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
    <Collapse size="small" items={lesson.concept.map((concept, index) => ({ key: String(index), label: concept.title, children: <Typography.Paragraph>{concept.body}</Typography.Paragraph> }))}/>
    <Collapse className="lab-challenge" items={[{ key: 'challenge', label: `进阶验证 · ${lesson.challenge.title}`, children: <Flex vertical gap={12}><Typography.Paragraph>{lesson.challenge.description}</Typography.Paragraph><Button onClick={() => setHint(!hint)}>{hint ? '隐藏提示' : '查看提示'}</Button>{hint && <Alert type="info" showIcon title={lesson.challenge.hint}/>}</Flex> }]}/>
    <Card className="lab-completion-check" title="记录实验">
      <Typography.Paragraph>{completionReason}</Typography.Paragraph>{!replay && !predictionReady && <Button type="link" icon={<BookOpen size={16}/>} onClick={revisitPrediction}>解释结果时，可以用这道题自查</Button>}
    </Card>
    {complete && <Alert id={`completion-${lesson.id}`} className="lab-completed-message" role="status" type="success" showIcon closable={{ onClose: () => setComplete(false) }} title="实验通过记录和运行证据已保存。" description={<Flex vertical gap={12}><Typography.Paragraph>{journey?.projectContribution ?? lesson.takeaway} </Typography.Paragraph><Space wrap><Button onClick={() => navigate(mapPath)}>返回学习路径</Button><Button onClick={() => navigate('/notebook')}>查看运行快照</Button>{nextLesson && <Button type="primary" onClick={() => navigate(chapterPath('lab', nextLesson.lessonId, search.toString()))}>继续：{nextLesson.title}</Button>}</Space></Flex>}/>}
  </Flex>;
  const views: { key: ObservationPanel; label: string; content: ReactNode }[] = [
    { key: 'flow', label: '执行流程', content: flowContent },
    { key: 'output', label: '运行记录与输出', content: outputContent },
    { key: 'principle', label: '原理动图', content: principleContent },
    { key: 'learning', label: '学习任务与自查', content: learningContent },
    { key: 'compare', label: '对比两次运行', content: comparisonContent },
  ];
  const scrollPane = (key: ObservationPanel, label: string, content: ReactNode) => <div
    ref={element => { if (element) panelScrollRefs.current[key] = element; else delete panelScrollRefs.current[key]; }}
    className="lab-panel-scroll" data-scroll-region={key} role="region" aria-label={`${label}，独立滚动区域`} tabIndex={0}
  >{content}</div>;
  return <ConfigProvider theme={{ token: { colorPrimary: '#254be0', colorText: '#27251f', colorTextSecondary: '#766f61', colorBgContainer: '#fffaf0', colorBorder: '#cfc5b2', colorFillAlter: '#f0e8d8', borderRadius: 5 }, components: { Card: { headerBg: '#f6efdf' }, Steps: { iconSizeSM: 28, titleLineHeight: 24 } } }}><div className={`developer-lab experiment-page ${presenting ? 'is-presenting' : ''}`}>
    {messageContext}
    <header className="lab-fixed-heading">
      <Flex className="lab-context-row" justify="space-between" align="center" gap={16}>
        <span className="chapter-instruction" title={guide?.goal ?? lesson.description}><strong>本章要弄懂　</strong>{guide?.goal ?? lesson.description}</span>
        <Space>{replay && <Tag className="replay-pill">历史回放</Tag>}<Tag color={learning.practice.passed ? 'success' : undefined}>{running ? '运行中' : practiceLabel}</Tag><Button type="text" icon={<Maximize2 size={16}/>} onClick={() => setPresenting(!presenting)}>{presenting ? '退出讲解' : '讲解模式'}</Button></Space>
      </Flex>
    </header>
    <div className="lab-workbench">
      <Card className="lab-code-panel" aria-label="代码编辑区域" title={<Space><span className="lab-page-mark">左页</span><Typography.Text strong>写代码</Typography.Text></Space>} extra={<Space>
        <Select<Language> aria-label="编程语言" value={language} onChange={switchLanguage} disabled={running || replay} style={{ width: 135 }} options={[{ value: 'typescript', label: 'TypeScript' }, { value: 'javascript', label: 'JavaScript' }, { value: 'python', label: 'Python' }]}/>
        <Tooltip title="恢复初始代码"><Button icon={<RotateCcw size={16}/>} disabled={running || replay} aria-label="恢复初始代码" onClick={() => { setCode(lesson.starter[language]); notify('已恢复初始代码'); }}/></Tooltip>
      </Space>} classNames={{ body: 'lab-code-body' }}>
        <Flex className="lab-run-toolbar" justify="space-between" align="center" gap={12}>
          {usesModel || /\blab\s*\.\s*model\s*\(/.test(code) ? <Segmented<RunMode> value={mode} disabled={running || replay} onChange={next => void changeMode(next)} options={[{ label: '教学模拟', value: 'demo' }, { label: '真实 API', value: 'live' }]}/> : <Typography.Text type="secondary">本地计算 · 无需密钥</Typography.Text>}
          <Space>{storyPeople !== null && !replay && code !== getStoryStarter(language, storyPeople) && <Button size="small" data-testid="load-story-example" disabled={running} onClick={() => { setCode(getStoryStarter(language, storyPeople)); notify(`已载入 ${storyPeople} 人的费用示例。点击运行查看实际结果。`); }}>载入 {storyPeople} 人示例</Button>}{replay ? <Button type="primary" data-testid="resume-editing" icon={<Code2 size={16}/>} onClick={resume}>继续编辑</Button> : running ? <Button type="primary" danger data-testid="stop-experiment" icon={<Square size={15}/>} onClick={() => controller.current?.abort()}>停止实验</Button> : <Tooltip title="⌘ / Ctrl + Enter"><Button type="primary" data-testid="run-experiment" icon={<Play size={16}/>} onClick={() => void run()}>{attempts.length ? '再跑一次' : '运行一下'}</Button></Tooltip>}</Space>
        </Flex>
        {frameFocus && <div className="lab-source-guide" data-testid="frame-code-guide" aria-live="polite"><strong>动图第 {(film?.frames.findIndex(frame => frame.id === frameId) ?? 0) + 1} 步</strong><span>{frameGuide.codeHint}</span><small>{frameLine ? '对照第 ' + frameLine.startLine + ' 行' : '当前代码没有唯一匹配的语句'}</small></div>}
        {sourceFocus === 'edit' && <div className="lab-source-guide" data-testid="edit-code-guide"><strong>这次改这里</strong><span>{lesson.id === 'tools' && toolPeople !== null ? changeTask : guide?.edit}</span><small>{editLine ? '第 ' + editLine.startLine + ' 行' : '当前代码已更改'}</small></div>}
        <div className="lab-editor" role="region" aria-label="代码，独立滚动区域"><CodeEditor code={code} language={language} onChange={setCode} location={editorLocation} revealKey={revealKey} readOnly={running || replay}/></div>
      </Card>
      <Card className="lab-observation-panel" aria-label="实验观察区域" classNames={{ body: 'lab-observation-body' }}>
        <Flex className="lab-observation-heading" align="center" justify="space-between" gap={8}>
          <Space>{panel !== 'flow' ? <Button size="small" icon={<ArrowLeft size={14}/>} onClick={() => setPanel('flow')}>回到拆解</Button> : <span className="lab-page-mark">右页</span>}<Typography.Text strong>{panel === 'flow' ? '实验讲解' : views.find(view => view.key === panel)?.label}</Typography.Text>{runStatus}</Space>
          <Space>{panel !== 'principle' && <Button size="small" icon={<Film size={14}/>} data-testid="principle-link" onClick={showFilm}>看动图</Button>}{attempts.length >= 2 && !replay && <Button size="small" data-testid="compare-runs" onClick={() => setPanel('compare')}>对比两次</Button>}<Dropdown trigger={['click']} menu={{ items: [{ key: 'output', label: '运行记录与输出' }, { key: 'learning', label: '学习任务与自查' }], onClick: ({ key }) => setPanel(key as ObservationPanel) }}><Button size="small" data-testid="observation-more">更多</Button></Dropdown></Space>
        </Flex>
        <div className="lab-view-stack">{views.map(view => <div key={view.key} className="lab-view" hidden={panel !== view.key}>{scrollPane(view.key, view.label, view.content)}</div>)}</div>
        <div className="lab-observation-footer" hidden={panel === 'principle' && !saveError}>
          {saveError && <Alert className="workspace-save-error" role="alert" type="error" showIcon title="保存未完成" description={saveError}/>}
          <Flex justify="space-between" align="center" gap={8}>
            <Typography.Text className="lab-evidence-status" type="secondary">{changedSinceRun ? '代码已修改 · 当前是旧证据' : continuedRunId && !freshRun && !replay ? '已恢复运行 · 未重新请求' : replay ? '只读历史记录' : result ? `本次 ${events.length} 个事件` : '等待实际运行'}</Typography.Text>
            <Space><Button data-testid="save-run" disabled={!result || saved || running} icon={saved ? <Check size={16}/> : <Save size={16}/>} onClick={storeRun}>{saved ? '快照已保存' : '保存快照'}</Button><Button type="primary" data-testid="complete-experiment" disabled={!canComplete} icon={<Check size={16}/>} onClick={finishLesson}>保存进度</Button></Space>
          </Flex>
          {result && !canComplete && <Button type="link" size="small" onClick={() => setPanel('learning')}>查看验证说明</Button>}
        </div>
      </Card>
    </div>
  </div></ConfigProvider>;
}
