import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Card, Segmented, Space, Table, Tag, Typography } from 'antd';
import { ApartmentOutlined, CloseOutlined, CodeOutlined, PlayCircleOutlined, UnorderedListOutlined } from '@ant-design/icons';
import { getLearningPathItem, getLearningSections, getPrincipleDefinition, LEARNING_PATH } from '../data/learning-path';
import type { LearningPathItem } from '../data/learning-path';
import { getLearningSummary, subscribeLearningState } from '../lib/learning-state';
import { getChapterReading, subscribeChapterReading } from '../lib/chapter-reading';
import { chapterProgressLabel, codeProgressLabel, courseHasPassedRun, mainCourseTitle, nextMainCourse } from './CourseRail';
import CourseRouteMap from './CourseRouteMap';
import ChapterRelations from './ChapterRelations';
import './knowledge-map.css';

type View = 'list' | 'relations';
type SavedView = { selected: string; view: View; entryAt: string | null; scrollTop?: number };
const VIEW_KEY = 'spark-lab:learning-graph:v1';
const sections = getLearningSections();
const titleFor = (id: string) => mainCourseTitle(id) ?? getLearningPathItem(id)?.title ?? id;
const numberFor = (id: string) => LEARNING_PATH.findIndex(item => item.lessonId === id) + 1;
const relationChapter = (id: string) => ({ id, title: titleFor(id), number: numberFor(id) });

function readView(): SavedView | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(VIEW_KEY) ?? 'null');
    if (!value || !getLearningPathItem(value.selected)) return null;
    const view = value.view === 'relations' || value.view === '关系总览' ? 'relations' : 'list';
    const sameLayout = value.view === 'relations' || value.view === 'list';
    return { selected: value.selected, view, entryAt: value.entryAt ?? null,
      ...(sameLayout && typeof value.scrollTop === 'number' && Number.isFinite(value.scrollTop) ? { scrollTop: Math.max(0, value.scrollTop) } : {}),
    };
  } catch { return null; }
}
function scrollWithinCatalogue(target: HTMLElement | null, onlyIfNeeded = false, animate = true) {
  const viewport = target?.closest<HTMLElement>('.atlas-catalogue');
  if (!target || !viewport) return;
  const behavior = !animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
  if (target === viewport) { viewport.scrollTo({ top: 0, behavior }); return; }
  const bounds = viewport.getBoundingClientRect();
  const targetBounds = target.getBoundingClientRect();
  const top = bounds.top + viewport.clientTop;
  if (onlyIfNeeded && targetBounds.top >= top + 12 && targetBounds.top + Math.min(200, targetBounds.height) <= top + viewport.clientHeight - 12) return;
  viewport.scrollTo({ top: Math.max(0, viewport.scrollTop + targetBounds.top - top - 12), behavior });
}

export default function KnowledgeMap() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const at = params.get('at');
  const entryAt = at && getLearningPathItem(at) ? at : null;
  const [saved] = useState(readView);
  const restore = useRef(Boolean(saved && (!entryAt || saved.entryAt === entryAt)));
  const [learning, setLearning] = useState(getLearningSummary);
  const fallbackView = useRef<View>(restore.current ? saved!.view : 'list');
  const view = params.get('view') === 'relations' ? 'relations' : fallbackView.current;
  const [currentChapter, setSelectedId] = useState(() => restore.current ? saved!.selected : entryAt ?? nextMainCourse(learning.lessons));
  const selectedId = view === 'relations' && entryAt ? entryAt : currentChapter;
  const [detailOpen, setDetailOpen] = useState(false);
  const mapScope = params.get('scope') === 'all' ? 'all' : 'chapter';
  const handledAt = useRef(entryAt);
  const mapCanvas = useRef<HTMLDivElement>(null);
  const catalogue = useRef<HTMLDivElement>(null);
  const rowToReveal = useRef<string | null>(null);
  const states = new Map(learning.lessons.map(state => [state.lessonId, state]));
  const item = getLearningPathItem(selectedId)!;
  const state = states.get(selectedId)!;
  const successors = LEARNING_PATH.filter(candidate => candidate.prerequisites.includes(selectedId));
  const deepPrinciple = item.principleSceneId ? getPrincipleDefinition(item.principleSceneId) : undefined;
  // Keep the original entry key; the session record restores the actual selected
  // chapter and local scroll position when the chapter returns here.
  const returnTo = view === 'relations'
    ? `/explore?view=relations&at=${encodeURIComponent(selectedId)}`
    : `/explore${params.size ? `?${params}` : ''}`;

  function saveView(selected = selectedId, currentView = view) {
    try { sessionStorage.setItem(VIEW_KEY, JSON.stringify({ selected, view: currentView, entryAt, scrollTop: catalogue.current?.scrollTop ?? 0 } satisfies SavedView)); } catch { /* Navigation remains usable without storage. */ }
  }
  function revealRow(id: string) {
    requestAnimationFrame(() => scrollWithinCatalogue(catalogue.current?.querySelector<HTMLElement>(`#atlas-course-${id}`) ?? null, true));
  }
  function select(id: string) {
    if (!getLearningPathItem(id)) return;
    setSelectedId(id);
    setDetailOpen(false);
    if (mapScope === 'all' || params.get('view') !== 'relations' || entryAt !== id) {
      setParams({ view: 'relations', at: id }, { replace: true });
    }
    requestAnimationFrame(() => mapCanvas.current?.querySelector<HTMLElement>('[data-current-chapter]')?.focus({ preventScroll: true }));
  }
  function switchView(target: View) {
    fallbackView.current = 'list';
    setSelectedId(selectedId);
    setDetailOpen(false);
    setParams(target === 'relations' ? { view: 'relations', at: selectedId } : { at: selectedId });
    rowToReveal.current = target === 'list' ? selectedId : null;
  }
  function closeDetail() {
    setDetailOpen(false);
    mapCanvas.current?.querySelector<HTMLElement>('.relation-info')?.focus({ preventScroll: true });
  }
  function jumpSection(id: string) {
    requestAnimationFrame(() => scrollWithinCatalogue(catalogue.current?.querySelector<HTMLElement>(`#atlas-section-${id}`) ?? null));
  }
  function openChapter(id: string, mode: 'learn' | 'lab') {
    saveView(id);
    setSelectedId(id);
    navigate(`/${mode}/${id}?returnTo=${encodeURIComponent(returnTo)}`);
  }
  useLayoutEffect(() => {
    if (view !== 'list' || !rowToReveal.current || !catalogue.current) return;
    const row = catalogue.current.querySelector<HTMLElement>(`#atlas-course-${rowToReveal.current}`);
    if (row) scrollWithinCatalogue(row, true, false);
    rowToReveal.current = null;
  }, [view]);
  useEffect(() => {
    const refresh = () => setLearning(getLearningSummary());
    const unsubscribe = subscribeLearningState(refresh);
    const unsubscribeReading = subscribeChapterReading(refresh);
    window.addEventListener('focus', refresh);
    return () => { unsubscribe(); unsubscribeReading(); window.removeEventListener('focus', refresh); };
  }, []);
  useEffect(() => {
    if (entryAt !== handledAt.current) {
      handledAt.current = entryAt;
      if (entryAt) {
        setSelectedId(entryAt);
        if (view === 'list') revealRow(entryAt);
      }
    }
    if (view === 'list') setDetailOpen(false);
  }, [entryAt, view]);
  useEffect(() => {
    if (restore.current && saved?.scrollTop !== undefined) {
      const { scrollTop } = saved;
      const frame = requestAnimationFrame(() => {
        if (!catalogue.current) return;
        catalogue.current.scrollTop = scrollTop;
        // A narrower/shorter viewport can make a saved pixel offset hide the
        // selected chapter. Preserve the offset when it is still visible.
        if (view === 'list') scrollWithinCatalogue(catalogue.current.querySelector<HTMLElement>(`#atlas-course-${selectedId}`), true);
      });
      return () => cancelAnimationFrame(frame);
    }
    if (view === 'list' && (entryAt || restore.current)) revealRow(selectedId);
  }, []);
  useEffect(() => { saveView(); }, [selectedId, view, entryAt]);

  const prerequisiteButtons = (course: LearningPathItem) => course.prerequisites.length ? course.prerequisites.map(id => <Button key={id} size="small" type="link" onClick={() => select(id)}>{titleFor(id)}</Button>) : <Typography.Text type="secondary">无需先修</Typography.Text>;
  const chapterActions = (id: string) => {
    const reading = getChapterReading(id);
    return <Space className="atlas-course-actions" size={8}><Button type="primary" icon={<PlayCircleOutlined/>} onClick={() => openChapter(id, 'learn')}>{reading.completed ? '重看动图' : reading.seen.length ? '继续动图' : '看动图'}</Button><Button icon={<CodeOutlined/>} onClick={() => openChapter(id, 'lab')}>练代码</Button></Space>;
  };

  if (view === 'relations') return (
    <section className="atlas-root atlas-view-relations" aria-label="课程先修关系" onKeyDownCapture={event => {
      if (detailOpen && event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeDetail();
      }
    }}>
      <div className={`atlas-map-layout${detailOpen ? ' has-detail' : ''}`}>
        <div ref={mapCanvas} className="atlas-map-canvas">
          <div className="atlas-map-toolbar">
            <Button icon={<UnorderedListOutlined/>} onClick={() => switchView('list')}>返回课程目录</Button>
            <Segmented aria-label="关系图范围" value={mapScope} options={[{ value: 'chapter', label: '当前章关系' }, { value: 'all', label: '全部课程' }]}
              onChange={value => {
                setDetailOpen(false);
                const next = new URLSearchParams({ view: 'relations', at: selectedId });
                if (value === 'all') next.set('scope', 'all');
                setParams(next, { replace: true });
              }}/>
          </div>
          {mapScope === 'chapter'
            ? <ChapterRelations chapter={relationChapter(selectedId)} before={item.prerequisites.map(relationChapter)}
                after={successors.map(next => relationChapter(next.lessonId))} actions={chapterActions(selectedId)}
                onSelect={select} onDetails={() => setDetailOpen(open => !open)}/>
            : <CourseRouteMap currentId={selectedId} describe={relationChapter} onSelect={select}/>}
        </div>
        {detailOpen && <aside className="atlas-detail" aria-label="当前课程信息">
          <Card className="atlas-course-sheet" size="small" title={`第 ${numberFor(selectedId)} 章 · ${titleFor(selectedId)}`}
            extra={<Button type="text" size="small" icon={<CloseOutlined/>} aria-label="关闭章节详情" onClick={closeDetail}/>}>
            <Typography.Paragraph className="atlas-objective">{item.objective}</Typography.Paragraph>
            <Space wrap className="atlas-detail-progress"><Typography.Text type="secondary">{chapterProgressLabel(selectedId)}</Typography.Text><Typography.Text type="secondary">{codeProgressLabel(state)}</Typography.Text></Space>
            {chapterActions(selectedId)}
            <div className="atlas-prerequisites">
              <div><Typography.Text strong>建议先学</Typography.Text><Space wrap size={0}>{prerequisiteButtons(item)}</Space></div>
              <div><Typography.Text strong>接着可以学</Typography.Text><Space wrap size={0}>{successors.length ? successors.map(next => <Button key={next.lessonId} size="small" type="link" onClick={() => select(next.lessonId)}>{titleFor(next.lessonId)}</Button>) : <Typography.Text type="secondary">本条路线到这里</Typography.Text>}</Space></div>
            </div>
            {deepPrinciple && <div className="atlas-deep-link"><Button size="small" type="link" onClick={() => navigate(`/theater?scene=${deepPrinciple.sceneId}&resume=unseen&returnTo=${encodeURIComponent(returnTo)}`)}>打开深度 A/B 对照演示</Button>{state.principle && <Typography.Text type="secondary">已看 {state.principle.viewedCount}/{state.principle.totalCount} 步</Typography.Text>}</div>}
          </Card>
        </aside>}
      </div>
    </section>
  );

  const watched = LEARNING_PATH.filter(course => getChapterReading(course.lessonId).completed).length;
  const passed = learning.lessons.filter(courseHasPassedRun).length;
  return <section className="atlas-root atlas-view-list" aria-labelledby="atlas-heading">
    <header className="atlas-header"><div><Typography.Text className="atlas-kicker">完整课程 · {LEARNING_PATH.length} 章</Typography.Text><Typography.Title level={2} id="atlas-heading">从第一问，学到自己的助手。</Typography.Title><Typography.Text type="secondary">每章先看动图，再用代码验证。按顺序学，也可以直接进入一章。</Typography.Text></div><div className="atlas-summary" aria-label="课程学习进度"><Typography.Text strong>你的学习记录</Typography.Text><Typography.Text type="secondary">动图看完 <strong>{watched}/{LEARNING_PATH.length}</strong> 章</Typography.Text><Typography.Text type="secondary">代码跑通 <strong>{passed}/{LEARNING_PATH.length}</strong> 章</Typography.Text></div></header>
    <div className="atlas-navigation"><Space className="atlas-section-links" size={4}>{sections.map(section => <Button key={section.id} type="text" onClick={() => jumpSection(section.id)}>{section.title}</Button>)}</Space><Button icon={<ApartmentOutlined/>} onClick={() => switchView('relations')}>查看先修关系</Button></div>
    <div ref={catalogue} className="atlas-catalogue" onScroll={() => saveView()} tabIndex={0} aria-label="课程目录内容">
      {sections.map(section => <section key={section.id} id={`atlas-section-${section.id}`} className="atlas-course-group" aria-labelledby={`atlas-group-title-${section.id}`}>
        <div className="atlas-group-heading"><Typography.Title level={3} id={`atlas-group-title-${section.id}`}>{section.title}</Typography.Title><Typography.Text type="secondary">第 {section.startIndex + 1}{section.lessons.length > 1 ? `–${section.startIndex + section.lessons.length}` : ''} 章</Typography.Text></div>
        <Table<LearningPathItem> className="atlas-course-table" size="middle" showHeader={false} pagination={false} rowKey="lessonId" dataSource={[...section.lessons]} onRow={course => ({ id: `atlas-course-${course.lessonId}` })} rowClassName={course => course.lessonId === selectedId ? 'atlas-row-selected' : ''} columns={[
          { key: 'number', width: 58, render: (_, course) => <Typography.Text className="atlas-course-number">{String(numberFor(course.lessonId)).padStart(2, '0')}</Typography.Text> },
          { key: 'chapter', render: (_, course) => <div className="atlas-course-cell"><div><Button type="link" onClick={() => openChapter(course.lessonId, 'learn')}>{titleFor(course.lessonId)}</Button>{course.lessonId === selectedId && <Tag className="atlas-current">当前</Tag>}</div><Typography.Text>{course.objective}</Typography.Text></div> },
          { key: 'progress', width: 173, render: (_, course) => <div className="atlas-course-progress"><Typography.Text type="secondary">{chapterProgressLabel(course.lessonId)}</Typography.Text><Typography.Text type="secondary">{codeProgressLabel(states.get(course.lessonId)!)}</Typography.Text></div> },
          { key: 'actions', width: 244, render: (_, course) => chapterActions(course.lessonId) },
        ]}/>
      </section>)}
    </div>
  </section>;
}
