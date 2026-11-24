import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Card, Steps, Tag, Typography } from 'antd';
import { CodeOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { getLessonJourney } from '../data/journey';
import { LEARNING_PATH } from '../data/learning-path';
import { getLearningSummary, subscribeLearningState } from '../lib/learning-state';
import { getChapterReading, subscribeChapterReading } from '../lib/chapter-reading';
import type { LessonLearningState } from '../lib/learning-state';
import './course-rail.css';

export const MAIN_COURSES = [
  { id: 'first-call', title: '让助手回答', headline: '把第一个问题交给助手。', action: '动手问一句' },
  { id: 'context', title: '带入背景', headline: '少一句背景，回答会变吗？', action: '试着拿走背景' },
  { id: 'tools', title: '使用工具', headline: '人数变了，总费用也要跟着变。', action: '改人数，追一遍计算' },
  { id: 'agent-loop', title: '完成多步任务', headline: '查资料、做计算，最后写出总结。', action: '去跑这三步任务' },
] as const;

export type CourseRailProps = {
  compact?: boolean;
  selectedId?: string;
  onSelect?: (id: string) => void;
  showCatalogLink?: boolean;
  returnTo?: string;
};
const COMPACT_TASKS: Record<string, { change: string; action: string }> = {
  'first-call': { change: '只把 question 改成“什么是 Agent？”。', action: '动手问一句' },
  context: { change: '把 history 设为 []，保留问题和 system。', action: '试着拿走背景' },
  tools: { change: '人数 people：17 → 19；单价 price 仍为 23。', action: '去改人数' },
  'agent-loop': { change: 'maxSteps：3 → 2；任务和工具保持不变。', action: '去跑多步任务' },
};
const SELECTION_KEY = 'spark-lab:course-rail:selected:v1';
export function mainCourseTitle(id: string): string | undefined { return MAIN_COURSES.find(item => item.id === id)?.title; }
export function mainCourseAction(id: string): string | undefined { return MAIN_COURSES.find(item => item.id === id)?.action; }
export function courseHasPassedRun(state: LessonLearningState): boolean {
  return state.practice.passed && (state.practice.passSource === 'recorded-run' || state.practice.passSource === 'saved-run');
}
export function codeProgressLabel(state: LessonLearningState): string {
  const last = state.practice.lastRun;
  const recent = last?.status === 'failed' ? '最近失败' : last?.status === 'cancelled' ? '最近中断' : null;
  if (!state.practice.available) return '代码未开放';
  if (courseHasPassedRun(state)) return `代码已跑通${recent ? ` · ${recent}` : ''}`;
  return recent ? `代码${recent}` : state.practice.hasRun ? '代码已尝试' : state.completionClaimed ? '代码待验证' : '代码未开始';
}
export function chapterProgressLabel(lessonId: string): string {
  const reading = getChapterReading(lessonId);
  return reading.total ? `动图已看 ${reading.seen.length}/${reading.total}` : '动图尚未浏览';
}
export function courseNeedsRetry(state: LessonLearningState): boolean {
  return state.practice.lastRun?.status === 'failed' || state.practice.lastRun?.status === 'cancelled';
}
export function nextMainCourse(states: readonly LessonLearningState[]): string {
  return MAIN_COURSES.find(course => {
    const state = states.find(item => item.lessonId === course.id);
    return !getChapterReading(course.id).completed || !state || !courseHasPassedRun(state) || courseNeedsRetry(state);
  })?.id ?? MAIN_COURSES[0].id;
}
function savedSelection(fallback: string): string {
  try { const id = sessionStorage.getItem(SELECTION_KEY); return id && mainCourseTitle(id) ? id : fallback; } catch { return fallback; }
}

/** The same four lessons, with a vertical layout for constrained sidebars. */
export default function CourseRail({ compact = false, selectedId, onSelect, showCatalogLink = true, returnTo = '/' }: CourseRailProps = {}) {
  const navigate = useNavigate();
  const [summary, setSummary] = useState(getLearningSummary);
  const [internalId, setInternalId] = useState(() => savedSelection(nextMainCourse(summary.lessons)));
  const pendingSelection = useRef<string | null>(null);
  const activeId = selectedId && mainCourseTitle(selectedId) ? selectedId : internalId;
  const activeIndex = Math.max(0, MAIN_COURSES.findIndex(course => course.id === activeId));
  const current = summary.lessons.find(item => item.lessonId === activeId)!;
  const journey = getLessonJourney(activeId)!;
  const reading = getChapterReading(activeId);
  useEffect(() => {
    const refresh = () => setSummary(getLearningSummary());
    const unsubscribe = subscribeLearningState(refresh);
    const unsubscribeReading = subscribeChapterReading(refresh);
    window.addEventListener('focus', refresh);
    return () => { unsubscribe(); unsubscribeReading(); window.removeEventListener('focus', refresh); };
  }, []);
  useEffect(() => {
    if (pendingSelection.current !== activeId) return;
    try { sessionStorage.setItem(SELECTION_KEY, activeId); } catch { /* Selection still works without storage. */ }
    pendingSelection.current = null;
  }, [activeId]);
  function choose(index: number) {
    const id = MAIN_COURSES[index].id;
    pendingSelection.current = id;
    setInternalId(id);
    onSelect?.(id);
  }
  const chapterHref = `/learn/${activeId}?returnTo=${encodeURIComponent(returnTo)}`;
  const actions = <div className="course-rail-actions"><Button type="primary" icon={<CodeOutlined/>} onClick={() => navigate(`/lab/${activeId}?returnTo=${encodeURIComponent(returnTo)}`)}>{courseNeedsRetry(current) ? (compact ? '检查上次运行' : '回代码查这次失败') : compact ? COMPACT_TASKS[activeId].action : MAIN_COURSES[activeIndex].action}</Button><Button type={compact ? 'default' : 'text'} icon={<PlayCircleOutlined/>} onClick={() => navigate(chapterHref)}>{reading.completed ? '重看本章动图' : reading.seen.length ? '继续本章动图' : '先看本章动图'}</Button></div>;
  return <section className={`course-rail${compact ? ' course-rail-compact' : ''}`} aria-label={`${MAIN_COURSES.length} 节入门课程`}>
    <div className="course-rail-scroll" tabIndex={compact ? 0 : undefined} aria-label={compact ? '课程步骤与当前练习' : undefined}>
    <Steps className="course-rail-stops" current={activeIndex} orientation={compact ? 'vertical' : 'horizontal'} responsive={false} onChange={choose} items={MAIN_COURSES.map((course, index) => {
      const state = summary.lessons.find(item => item.lessonId === course.id)!;
      const chapter = getChapterReading(course.id);
      const active = index === activeIndex;
      const untouched = !chapter.seen.length && !state.practice.hasRun && !state.completionClaimed;
      const finished = chapter.completed && courseHasPassedRun(state) && !courseNeedsRetry(state);
      return {
        key: course.id, title: course.title,
        icon: <span className="course-rail-number">{index + 1}</span>,
        subTitle: <Tag className={active ? 'course-rail-stamp' : 'course-rail-state'}>{active ? (compact ? '当前' : '这一节动手') : untouched ? (compact ? '未开始' : '还没开始') : finished ? (compact ? '可复习' : '可以复习') : '接着学'}</Tag>,
        status: active ? 'process' as const : courseNeedsRetry(state) ? 'error' as const : finished ? 'finish' as const : 'wait' as const,
        content: <div className="course-rail-progress"><Typography.Text type="secondary">{chapterProgressLabel(course.id)}</Typography.Text><Typography.Text type="secondary">{codeProgressLabel(state)}</Typography.Text></div>,
      };
    })}/>
    <Card className="course-rail-detail" size="small" aria-label={`${MAIN_COURSES[activeIndex].title}的实验任务`}>
      <div className="course-rail-detail-layout">
        <div className="course-rail-question">{!compact && <Typography.Text className="course-rail-label">轮到你试试</Typography.Text>}<Typography.Title level={5}>{MAIN_COURSES[activeIndex].headline}</Typography.Title><div className="course-rail-change"><Typography.Text strong>只动这一处</Typography.Text><Typography.Text>{compact ? COMPACT_TASKS[activeId].change : journey.change}</Typography.Text></div></div>
        {!compact && actions}
      </div>
      {courseNeedsRetry(current) && <Alert className="course-rail-run-note" type="warning" showIcon title={`${courseHasPassedRun(current) ? '此前已跑通；' : ''}最近一次${current.practice.lastRun?.status === 'failed' ? '运行失败' : '已中断'}，可以回到代码检查。`}/>}
    </Card>
    </div>
    {compact && <div className="course-rail-dock">{actions}</div>}
    <div className="course-rail-footer"><Typography.Text type="secondary">{compact ? '看过与跑通，分开记录。' : '动图看过哪几步、代码有没有跑通，这里分开记。'}</Typography.Text>{showCatalogLink && <Button type="link" onClick={() => navigate(`/explore?at=${activeId}`)}>{compact ? `全部 ${LEARNING_PATH.length} 章` : `查看全部 ${LEARNING_PATH.length} 章课程`}</Button>}</div>
  </section>;
}
