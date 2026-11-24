import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Button, Result, Segmented, Select, Spin } from 'antd';
import { ArrowLeft, ArrowRight, BookOpen, Code2, Film, SlidersHorizontal } from 'lucide-react';
import { getLearningSections, LEARNING_PATH } from '../data/learning-path';
import { getChapterFilm } from '../data/chapter-films';
import { lessons } from '../data/lessons';
import { getLanguage } from '../lib/storage';
import { locateFrameInCode } from '../lib/execution-inspector';
import { getPracticeGuide } from '../data/practice-guides';
import { catalogueReturn, chapterPath, rememberChapter, type ChapterMode } from '../lib/chapter-navigation';
import { getChapterReading } from '../lib/chapter-reading';
import { getLearningSummary } from '../lib/learning-state';
import { codeProgressLabel } from './CourseRail';
import ReadChapterFilm from './ReadChapterFilm';
import './chapter-reader.css';

const Workspace = lazy(() => import('./Workspace'));
const sections = getLearningSections();
const options = sections.map(section => ({ label: section.title, options: section.lessons.map((item, index) => ({
  value: item.lessonId, label: String(section.startIndex + index + 1).padStart(2, '0') + '　' + item.title,
})) }));

function progressInPicker() {
  return new Map(getLearningSummary().lessons.map(lesson => {
    const reading = getChapterReading(lesson.lessonId);
    const watched = reading.completed ? '动图已看完' : '动图 ' + reading.seen.length + '/' + reading.total;
    return [lesson.lessonId, watched + ' · ' + codeProgressLabel(lesson)];
  }));
}

export default function ChapterReader({ mode, onConnect }: { mode: ChapterMode; onConnect: () => void }) {
  const { lessonId = '' } = useParams();
  const { search } = useLocation();
  const navigate = useNavigate();
  const index = LEARNING_PATH.findIndex(item => item.lessonId === lessonId);
  const chapter = LEARNING_PATH[index];
  const prev = LEARNING_PATH[index - 1], next = LEARNING_PATH[index + 1];
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(new Map<string, string>());
  useEffect(() => {
    if (chapter && !new URLSearchParams(search).has('replay')) rememberChapter(mode, chapter.lessonId);
  }, [chapter, mode, search]);
  const [shown, setShown] = useState({ lessonId: '', frameId: '' });
  const reportFrame = useCallback((frameId: string) => setShown(previous =>
    previous.lessonId === lessonId && previous.frameId === frameId ? previous : { lessonId, frameId }), [lessonId]);
  if (!chapter) return <Result status="404" title="找不到这一章" extra={<Button href="/explore">打开课程目录</Button>}/>;
  const returnPath = catalogueReturn(search, lessonId);
  const frames = getChapterFilm(lessonId)?.frames ?? [];
  const requested = frames.find(frame => frame.id === new URLSearchParams(search).get('frame'))?.id;
  const currentFrame = (shown.lessonId === lessonId && frames.find(frame => frame.id === shown.frameId)?.id) || requested;
  function framePath(target: ChapterMode) {
    const params = new URLSearchParams(search);
    if (currentFrame) params.set('frame', currentFrame);
    return chapterPath(target, lessonId, params.toString(), true);
  }
  const guide = getPracticeGuide(lessonId);
  const frameGuide = currentFrame ? guide?.frames[currentFrame] : undefined;
  const language = getLanguage();
  const example = mode === 'learn' ? lessons.find(lesson => lesson.id === lessonId)?.starter[language] : undefined;
  const line = example && frameGuide ? locateFrameInCode(example, language, frameGuide) : null;
  const snippet = line && example ? example.split('\n')[line.startLine - 1]?.trim() : undefined;
  return <section className={'chapter-reader chapter-reader-' + mode} aria-label={chapter.title + '章节'}>
    <nav className="chapter-toolbar" aria-label="章节导航">
      <div className="chapter-picker"><Button type="text" title={returnPath === '/' ? '返回体验台' : '完整课程目录'} aria-label={returnPath === '/' ? '返回体验台' : '完整课程目录'} icon={<BookOpen size={18}/>} disabled={running} onClick={() => navigate(returnPath)}>{returnPath === '/' ? '体验台' : '课程目录'}</Button>
        <Select aria-label="跳转章节" showSearch={{optionFilterProp: 'label'}} disabled={running} value={lessonId} labelRender={() => String(index + 1).padStart(2, '0') + ' / ' + LEARNING_PATH.length + '　' + chapter.title} options={options} onOpenChange={open => { if (open) setProgress(progressInPicker()); }}
          optionRender={option => <span className="chapter-picker-option"><span>{option.label}</span><small>{progress.get(String(option.value))}</small></span>}
          onChange={id => navigate(chapterPath(mode,id,search))} popupMatchSelectWidth={438}/>
      </div>
      <Segmented<ChapterMode> aria-label="本章学习方式" value={mode} disabled={running} onChange={target => navigate(framePath(target))} options={[{ value:'learn', label: '原理动图', icon:<Film size={15}/> }, { value:'lab', label:'代码实战', icon:<Code2 size={15}/> }]}/>
      <div className="chapter-paging"><Button type="text" disabled={!prev || running} aria-label={'上一章' + (prev ? ' ' + prev.title : '')} title={prev?.title} icon={<ArrowLeft size={15}/>} onClick={() => prev && navigate(chapterPath(mode,prev.lessonId,search))}>上一章</Button>
        {next ? <Button disabled={running} className="chapter-next" aria-label={'下一章 ' + next.title} onClick={() => navigate(chapterPath(mode,next.lessonId,search))}>下一章 · {next.title}<ArrowRight size={15}/></Button> : <Button disabled={running} onClick={() => navigate('/notebook')}>查看学习记录<ArrowRight size={15}/></Button>}
      </div>
    </nav>
    {mode === 'learn' ? <div className="chapter-film-page">
      {chapter.leadIn && <p className="chapter-leadin">{chapter.leadIn}</p>}
      <ReadChapterFilm key={lessonId + ':' + (requested ?? '')} lessonId={lessonId} startFrameId={requested ?? currentFrame} onFrameChange={reportFrame}/>
      <div className="chapter-to-practice"><div>{snippet ? <><strong>示例代码</strong><code title={snippet}>{snippet}</code></> : <><strong>动手试试</strong><span>{guide?.edit ?? chapter.objective}</span></>}</div>
        {chapter.principleSceneId && <Link className="chapter-comparison" to={'/theater?' + new URLSearchParams({scene:chapter.principleSceneId,returnTo:framePath(mode)})}><SlidersHorizontal size={15}/>参数对照</Link>}
        <Button type="primary" icon={<Code2 size={16}/>} onClick={() => navigate(framePath('lab'))}>对照这一步的代码</Button>
      </div>
    </div> : <div className="chapter-workspace"><Suspense fallback={<Spin/>}><Workspace onConnect={onConnect} onRunningChange={setRunning} onFrameChange={reportFrame}/></Suspense></div>}
  </section>;
}
