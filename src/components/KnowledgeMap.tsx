import { useEffect, useRef, useState } from 'react';
import type { ComponentProps } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Button, Card, Collapse, Divider, Empty, Flex, Progress, Space, Tabs, Tag, Typography } from 'antd';
import { BookOutlined, CheckCircleOutlined, CodeOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import { lessons } from '../data/lessons';
import { getLearningPathItem, getPrincipleDefinition, LEARNING_PATH } from '../data/learning-path';
import { getLessonJourney } from '../data/journey';
import type { LearningPathItem, LearningStage } from '../data/learning-path';
import { getLearningSummary, subscribeLearningState } from '../lib/learning-state';
import type { LessonLearningState } from '../lib/learning-state';
import LearningDiagram from './LearningDiagram';
import './knowledge-map.css';

type View = LearningStage | '关系总览';
type SavedView = { selected: string; view: View; entryAt: string | null };
const views: View[] = ['基础主线', '应用进阶', '模型原理', '关系总览'];
const viewLabels: Record<View, string> = { 基础主线: '主线项目', 应用进阶: '后续应用', 模型原理: '模型原理', 关系总览: '先修关系总览' };
const VIEW_KEY = 'spark-lab:learning-graph:v1';

function readView(): SavedView | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(VIEW_KEY) ?? 'null');
    return value && getLearningPathItem(value.selected) && views.includes(value.view) ? value as SavedView : null;
  } catch { return null; }
}
function needsRetry(state: LessonLearningState): boolean {
  return state.practice.lastRun?.status === 'failed' || state.practice.lastRun?.status === 'cancelled';
}
function principleText(state: LessonLearningState): string {
  return state.principleAvailable && state.principle ? `原理 ${state.principle.viewedCount}/${state.principle.totalCount} 步已浏览` : '原理未开放';
}
function practiceText(state: LessonLearningState): string {
  if (!state.practice.available) return '实操未开放';
  if (state.practice.lastRun?.status === 'failed') return '实操最近失败';
  if (state.practice.lastRun?.status === 'cancelled') return '实操已中断';
  if (state.practice.passed) return '实操已跑通';
  return state.practice.hasRun ? '实操已尝试' : '实操未运行';
}
function nodeStatus(state: LessonLearningState, selected: boolean): string {
  if (selected) return '当前';
  if (!state.principleAvailable && !state.practice.available) return '未开放';
  if (needsRetry(state)) return '需检查';
  if (state.principle?.completed) return '原理已看完';
  return state.principle?.viewedCount ? '继续学习' : '未浏览';
}
function principlePercent(state: LessonLearningState): number {
  return state.principle?.totalCount ? Math.round(state.principle.viewedCount / state.principle.totalCount * 100) : 0;
}
function scrollWithinMain(target: HTMLElement | null, onlyIfNeeded = false): void {
  const main = target?.closest<HTMLElement>('.lab-main');
  if (!target || !main) return;
  const bounds = main.getBoundingClientRect();
  const targetBounds = target.getBoundingClientRect();
  const viewportTop = bounds.top + main.clientTop;
  const viewportBottom = viewportTop + main.clientHeight;
  const inset = 24;
  const visibleHeight = Math.min(220, targetBounds.height);
  if (onlyIfNeeded && targetBounds.top >= viewportTop + inset && targetBounds.top + visibleHeight <= viewportBottom - inset) return;
  main.scrollTo({
    top: Math.max(0, main.scrollTop + targetBounds.top - viewportTop - inset),
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
  });
}
function levelsFor(items: readonly LearningPathItem[]): Map<string, number> {
  const ids = new Set(items.map((item) => item.lessonId));
  const levels = new Map<string, number>();
  const pending = new Set<string>();
  const visit = (id: string): number => {
    if (levels.has(id)) return levels.get(id)!;
    if (pending.has(id)) return 0;
    pending.add(id);
    const parents = getLearningPathItem(id)!.prerequisites.filter((parent) => ids.has(parent));
    const depth = parents.length ? Math.max(...parents.map(visit)) + 1 : 0;
    pending.delete(id); levels.set(id, depth); return depth;
  };
  items.forEach((item) => visit(item.lessonId));
  return levels;
}

export default function KnowledgeMap() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const at = params.get('at');
  const entryAt = at && getLearningPathItem(at) ? at : null;
  const saved = useRef(readView());
  const restore = useRef(Boolean(saved.current && (!entryAt || saved.current.entryAt === entryAt)));
  const [learning, setLearning] = useState(getLearningSummary);
  const stateById = new Map(learning.lessons.map((state) => [state.lessonId, state]));
  const nextId = learning.lessons.find((state) => getLearningPathItem(state.lessonId)?.stage === '基础主线' && (state.remaining.principleFrameIds.length || state.remaining.needsPassingRun || needsRetry(state)))?.lessonId ?? 'first-call';
  const [selectedId, setSelectedId] = useState(restore.current ? saved.current!.selected : entryAt ?? nextId);
  const [view, setView] = useState<View>(restore.current ? saved.current!.view : entryAt ? getLearningPathItem(entryAt)!.stage : '基础主线');
  const detail = useRef<HTMLDivElement>(null);
  const diagram = useRef<HTMLDivElement>(null);
  const handledAt = useRef(entryAt);
  const current = stateById.get(selectedId)!;
  const item = getLearningPathItem(selectedId)!;
  const journey = getLessonJourney(selectedId);
  const successors = LEARNING_PATH.filter((candidate) => candidate.prerequisites.includes(selectedId));
  const relatedIds = new Set([selectedId, ...item.prerequisites, ...successors.map((candidate) => candidate.lessonId)]);
  const lesson = lessons.find((candidate) => candidate.id === selectedId)!;
  const principle = current.principle;
  const remainingSteps = current.remaining.principleFrameIds.length;
  const currentFinished = remainingSteps === 0 && current.practice.passed && !needsRetry(current);
  const nextSuccessor = currentFinished ? successors.find((candidate) => {
    const state = stateById.get(candidate.lessonId)!;
    return (state.principleAvailable && state.remaining.principleFrameIds.length > 0) || (state.practice.available && (!state.practice.passed || needsRetry(state)));
  }) : undefined;
  const definition = principle ? getPrincipleDefinition(principle.sceneId) : undefined;
  const nextFrame = definition?.frames.find((frame) => frame.id === principle?.firstUnseenFrameId);
  const returnTo = `/explore${params.toString() ? `?${params.toString()}` : ''}`;
  const principleHref = principle ? `/theater?scene=${principle.sceneId}&returnTo=${encodeURIComponent(returnTo)}` : '';
  const visibleItems = LEARNING_PATH.filter((candidate) => view === '关系总览' || candidate.stage === view);
  const visibleIds = new Set(visibleItems.map((candidate) => candidate.lessonId));
  const levels = levelsFor(visibleItems);
  const rowCounts = new Map<number, number>();
  const positions = new Map<string, { x: number; y: number }>();
  for (const candidate of visibleItems) {
    const column = levels.get(candidate.lessonId)!;
    const row = rowCounts.get(column) ?? 0;
    positions.set(candidate.lessonId, { x: column * 340, y: row * 250 });
    rowCounts.set(column, row + 1);
  }
  const externalParents = [...new Set(visibleItems.flatMap((candidate) => candidate.prerequisites))].filter((id) => !visibleIds.has(id));
  const mainStates = learning.lessons.filter((state) => getLearningPathItem(state.lessonId)?.stage === '基础主线');
  const totalSteps = mainStates.reduce((sum, state) => sum + (state.principle?.totalCount ?? 0), 0);
  const viewedSteps = mainStates.reduce((sum, state) => sum + (state.principle?.viewedCount ?? 0), 0);
  const unopenedCount = learning.lessons.filter((state) => !state.principleAvailable && !state.practice.available).length;

  function select(id: string, followStage = false) {
    const target = getLearningPathItem(id);
    if (!target) return;
    setSelectedId(id);
    if (followStage && view !== '关系总览') setView(target.stage);
    requestAnimationFrame(() => scrollWithinMain(detail.current, true));
  }
  function switchView(target: View) {
    setView(target);
    if (target !== '关系总览' && item.stage !== target) setSelectedId(target === '基础主线' ? nextId : LEARNING_PATH.find((candidate) => candidate.stage === target)!.lessonId);
  }

  useEffect(() => {
    const refresh = () => setLearning(getLearningSummary());
    const unsubscribe = subscribeLearningState(refresh);
    window.addEventListener('focus', refresh);
    return () => { unsubscribe(); window.removeEventListener('focus', refresh); };
  }, []);
  useEffect(() => {
    if (entryAt && entryAt !== handledAt.current) {
      handledAt.current = entryAt; setSelectedId(entryAt); setView(getLearningPathItem(entryAt)!.stage);
    }
  }, [entryAt]);
  useEffect(() => {
    try { sessionStorage.setItem(VIEW_KEY, JSON.stringify({ selected: selectedId, view, entryAt } satisfies SavedView)); } catch { /* Selection remains usable without storage. */ }
  }, [selectedId, view, entryAt]);

  const nodes: ComponentProps<typeof LearningDiagram>['nodes'] = visibleItems.map((candidate) => {
    const state = stateById.get(candidate.lessonId)!;
    const selected = selectedId === candidate.lessonId;
    const candidateJourney = getLessonJourney(candidate.lessonId);
    const relation = view === '关系总览' && !selected && item.prerequisites.includes(candidate.lessonId) ? '直接先修' : view === '关系总览' && !selected && successors.some((next) => next.lessonId === candidate.lessonId) ? '直接后续' : nodeStatus(state, selected);
    return {
      id: candidate.lessonId,
      title: candidate.title,
      subtitle: candidate.stage === '基础主线' ? `第 ${Number(lessons.find((entry) => entry.id === candidate.lessonId)!.number)} 节` : candidate.stage,
      state: selected ? 'active' : needsRetry(state) ? 'error' : state.principle?.completed && state.practice.passed ? 'done' : 'idle',
      dimmed: view === '关系总览' && !relatedIds.has(candidate.lessonId),
      position: view === '应用进阶' || view === '关系总览' ? positions.get(candidate.lessonId) : undefined,
      detail: <div className="atlas-node-content" data-lesson-id={candidate.lessonId}>
        {!selected && !needsRetry(state) && !(state.principle?.completed && state.practice.passed) && <Tag>{relation}</Tag>}
        {candidateJourney && view === '基础主线' && <><Typography.Paragraph className="atlas-node-question">{candidateJourney.question}</Typography.Paragraph><div><Typography.Text type="secondary">新增能力</Typography.Text><Typography.Paragraph className="atlas-node-contribution">{candidateJourney.projectContribution}</Typography.Paragraph></div></>}
        <div><Typography.Text type="secondary">{principleText(state)}</Typography.Text>{state.principleAvailable && <Progress aria-label={principleText(state)} percent={principlePercent(state)} showInfo={false} size="small" status="normal"/>}</div>
        <Tag color={needsRetry(state) ? 'error' : state.practice.passed ? 'blue' : undefined} icon={needsRetry(state) ? <ExclamationCircleOutlined/> : state.practice.passed ? <CheckCircleOutlined/> : <CodeOutlined/>}>{practiceText(state)}</Tag>
      </div>,
    };
  });
  const edges: ComponentProps<typeof LearningDiagram>['edges'] = visibleItems.flatMap((candidate) => candidate.prerequisites.filter((id) => visibleIds.has(id)).map((parent) => ({
    source: parent, target: candidate.lessonId,
    emphasis: selectedId === parent || selectedId === candidate.lessonId,
    dashed: !stateById.get(parent)?.principle?.completed,
  })));

  return <section className="atlas-root" aria-labelledby="atlas-heading">
    <header className="atlas-header"><div><Typography.Text type="secondary">项目学习路径</Typography.Text><Typography.Title level={1} id="atlas-heading">做一个可靠的学习助手</Typography.Title><Typography.Paragraph type="secondary">围绕同一个助手，用四次小实验接通回答、背景、工具和循环。</Typography.Paragraph></div><div className="atlas-summary" aria-label="主线学习进度"><Typography.Text>主线原理 {viewedSteps}/{totalSteps} 步已浏览</Typography.Text><Progress percent={totalSteps ? Math.round(viewedSteps / totalSteps * 100) : 0} showInfo={false} status="normal" size="small"/><Typography.Text type="secondary">主线实操 {learning.passedPracticeCount}/{learning.availablePracticeCount} 节已跑通</Typography.Text></div></header>
    <Tabs aria-label="课程关系视图" activeKey={view} items={views.map((target) => ({ key: target, label: viewLabels[target] }))} onChange={(key) => switchView(key as View)}/>
    <div className="atlas-layout">
      <div ref={diagram} className="atlas-diagram-panel">
        <Card title={view === '基础主线' ? '每往前一节，助手多一种能力' : view === '关系总览' ? `聚焦：${item.title}的直接先修与后续` : viewLabels[view]} extra={<Typography.Text type="secondary">箭头表示建议先修顺序</Typography.Text>}>
          <Flex vertical gap="middle">
            {view === '应用进阶' && <Alert type="info" showIcon title="后续规划" description="这些课程目前可读概要，原理与实操尚未开放。"/>}
            {view === '模型原理' && <Alert type="info" showIcon title="Token 与采样原理可看" description="Transformer、训练与适配的原理及实操尚未开放。"/>}
            {view === '关系总览' && <Flex wrap gap="middle" align="center" aria-label={`${item.title}的直接课程关系`}><Space wrap><Typography.Text type="secondary">直接先修</Typography.Text>{item.prerequisites.length ? item.prerequisites.map((id) => <Button key={id} size="small" onClick={() => select(id)}>{getLearningPathItem(id)!.title}</Button>) : <Tag>无先修</Tag>}</Space><Tag color="blue">当前：{item.title}</Tag><Space wrap><Typography.Text type="secondary">直接后续</Typography.Text>{successors.length ? successors.map((next) => <Button key={next.lessonId} size="small" onClick={() => select(next.lessonId)}>{next.title}</Button>) : <Tag>无后续课程</Tag>}</Space></Flex>}
            {externalParents.length > 0 && <Space wrap><Typography.Text type="secondary">本阶段需要</Typography.Text>{externalParents.map((id) => <Button size="small" key={id} onClick={() => select(id, true)}>{getLearningPathItem(id)!.title}</Button>)}</Space>}
            <LearningDiagram key={view} nodes={nodes} edges={edges} height={view === '基础主线' ? 460 : view === '关系总览' ? 600 : 460} nodeWidth={view === '基础主线' ? 280 : 260} selectedId={selectedId} onSelect={(id) => select(id)} controls ariaLabel="课程先修关系图"/>
            <Typography.Text type="secondary">实线：前置原理已浏览；虚线：前置原理尚未看完。先修是学习建议，不锁定课程。</Typography.Text>
            {view === '基础主线' && <Space wrap size="middle"><Typography.Text type="secondary">主线之外</Typography.Text><Button onClick={() => select('tokens', true)}>Token 与采样 · 原理可看</Button><Button onClick={() => switchView('关系总览')}>{unopenedCount} 节未开放 · 查看规划与概要</Button></Space>}
          </Flex>
        </Card>
      </div>
      <div ref={detail} className="atlas-detail" aria-label="选中课程的目标和下一步" aria-live="polite">
        <Card title={<Space><Typography.Text strong>{item.title}</Typography.Text><Tag color="blue">{item.stage}</Tag>{current.completionClaimed && <Tag>已标记完成</Tag>}</Space>} extra={<Button type="text" onClick={() => scrollWithinMain(diagram.current)}>返回课程关系</Button>}>
          <div className="atlas-detail-grid">
            <div className="atlas-detail-content">
              <Typography.Text type="secondary">{journey ? '这节为助手补上什么' : '后续学习目标'}</Typography.Text>
              <Typography.Paragraph className="atlas-objective">{journey?.projectContribution ?? item.objective}</Typography.Paragraph>
              {journey && <><Typography.Title level={5}>为什么学这一节</Typography.Title><Typography.Paragraph type="secondary">{journey.why}</Typography.Paragraph><Typography.Title level={5}>动手只改一处</Typography.Title><Typography.Paragraph type="secondary">{journey.change}</Typography.Paragraph><Collapse items={[{ key: 'evidence', label: '运行后，用什么证据判断', children: <ul className="atlas-observations">{journey.observe.map((evidence) => <li key={evidence}>{evidence}</li>)}</ul> }]}/></>}
              {!current.principleAvailable && <Collapse items={[{ key: 'concept', label: '阅读概念概要', children: <Typography.Paragraph>{lesson.concept[0].body}</Typography.Paragraph> }]}/>}
            </div>
            <div className="atlas-detail-next">
              <Flex vertical gap="small"><Typography.Text><BookOutlined/> {principleText(current)}</Typography.Text>{current.principleAvailable && <Progress percent={principlePercent(current)} showInfo={false} status="normal" size="small"/>}<Tag color={needsRetry(current) ? 'error' : current.practice.passed ? 'blue' : undefined} icon={<CodeOutlined/>}>{practiceText(current)}</Tag></Flex>
              <Typography.Title level={5}>接下来要做</Typography.Title>
              {remainingSteps > 0 && <Typography.Paragraph type="secondary">原理还剩 {remainingSteps} 步{nextFrame ? `，从「${nextFrame.title}」继续` : ''}。</Typography.Paragraph>}
              {current.practice.available && (!current.practice.passed || needsRetry(current)) && (needsRetry(current) ? <Alert type="warning" showIcon title={`最近一次${current.practice.lastRun?.status === 'failed' ? '运行失败' : '运行中断'}`} description={`${current.practice.passed ? '之前已跑通，但' : ''}最近一次未完成，需要回到代码检查。`}/> : <Typography.Paragraph type="secondary">{current.practice.hasRun ? '实操已尝试，还需检查输出与本章验证结果。' : '实操尚未运行，动手修改代码并观察结果。'}</Typography.Paragraph>)}
              {currentFinished && <Typography.Paragraph type="secondary">原理已看完，实操已跑通。可以继续下一项知识，也可以复习。</Typography.Paragraph>}
              {!current.practice.available && <Typography.Paragraph type="secondary">{item.upcoming ?? '实操尚未开放。'}</Typography.Paragraph>}
              {!current.principleAvailable && !current.practice.available && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="原理与实操尚未开放"/>}
              <Flex vertical gap="small" className="atlas-actions">
                {nextSuccessor && <Button type="primary" block onClick={() => select(nextSuccessor.lessonId, true)}>继续：{nextSuccessor.title}</Button>}
                {current.principleAvailable && <Button type={remainingSteps > 0 || !current.practice.available ? 'primary' : 'default'} block onClick={() => navigate(principleHref)}>{remainingSteps > 0 ? `继续原理 · ${remainingSteps} 步未看` : '复习原理'}</Button>}
                {current.practice.available && <Button type={remainingSteps === 0 && !nextSuccessor ? 'primary' : 'default'} block onClick={() => navigate(`/lab/${selectedId}`)}>{needsRetry(current) ? '回到代码检查' : current.practice.passed ? '再次运行代码' : '进入代码实验'}</Button>}
                {!current.principleAvailable && !current.practice.available && <Button block onClick={() => select(nextId, true)}>继续基础主线</Button>}
              </Flex>
            </div>
          </div>
          <Divider/>
          <Flex gap="large" wrap><Space wrap><Typography.Text type="secondary">直接先修</Typography.Text>{item.prerequisites.length ? item.prerequisites.map((id) => <Button key={id} size="small" onClick={() => select(id, true)}>{getLearningPathItem(id)!.title}</Button>) : <Typography.Text>无，可以从这里开始</Typography.Text>}</Space><Space wrap><Typography.Text type="secondary">直接后续</Typography.Text>{successors.length ? successors.map((next) => <Button key={next.lessonId} size="small" onClick={() => select(next.lessonId, true)}>{next.title}</Button>) : <Typography.Text>当前路径没有后续课程</Typography.Text>}</Space></Flex>
        </Card>
      </div>
    </div>
    <Typography.Paragraph type="secondary" className="atlas-evidence-note">浏览原理、运行代码分别记录。进度表示已进行的学习活动，不代表已经掌握。</Typography.Paragraph>
  </section>;
}
