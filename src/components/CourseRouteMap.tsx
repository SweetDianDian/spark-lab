import { Fragment } from 'react';
import { Button } from 'antd';
import { ArrowRightOutlined, PlusOutlined } from '@ant-design/icons';
import { getCourseRoutes } from '../data/course-routes';
import type { RelationChapter } from './ChapterRelations';
import './course-route-map.css';

const routes = getCourseRoutes();

export default function CourseRouteMap({ currentId, describe, onSelect }: {
  currentId: string;
  describe: (id: string) => RelationChapter;
  onSelect: (id: string) => void;
}) {
  function chapterButton(id: string, reference = false) {
    const info = describe(id);
    return <Button className={reference ? 'route-reference' : 'route-chapter'} type={reference ? 'text' : 'default'}
      data-reference={reference ? id : undefined} data-route-chapter={reference ? undefined : id}
      aria-current={id === currentId ? 'step' : undefined} onClick={() => onSelect(id)}>
      <span className="route-number">{String(info.number).padStart(2, '0')}</span>
      <span>{info.title}</span>
    </Button>;
  }

  return <div className="course-routes" role="region" aria-label="全部课程先修关系图" tabIndex={0}>
    <div className="course-route-grid">
      {routes.map(route => {
        const entry = route.steps[0];
        const wide = route.steps.length >= 3 || route.sectionId === 'project';
        return <section key={route.id} className={`course-route${wide ? ' route-wide' : ''}`}
          aria-labelledby={'route-' + route.id} data-route={route.id}>
          <h3 id={'route-' + route.id}>{route.title}</h3>
          <div className="route-chain">
            {entry.extraPrerequisites.length > 0 && <>
              <div className="route-sources" role="group" aria-label={describe(entry.lessonId).title + '的先修章节'}>
                {entry.extraPrerequisites.map((source, index) => <Fragment key={source}>
                  {index > 0 && <PlusOutlined className="route-plus" aria-hidden/>}
                  <span data-source={source} data-target={entry.lessonId}>{chapterButton(source, true)}</span>
                </Fragment>)}
              </div>
              <ArrowRightOutlined className="route-arrow" aria-hidden/>
            </>}
            {route.steps.map((step, index) => <Fragment key={step.lessonId}>
              {index > 0 && <ArrowRightOutlined className="route-arrow" data-source={route.steps[index - 1].lessonId} data-target={step.lessonId}
                aria-label={describe(route.steps[index - 1].lessonId).title + '是' + describe(step.lessonId).title + '的先修章节'}/>}
              <div className="route-stop">
                {chapterButton(step.lessonId)}
                {index > 0 && step.extraPrerequisites.length > 0 && <div className="route-extra"><span>另需</span>
                  {step.extraPrerequisites.map(id => <span key={id} data-source={id} data-target={step.lessonId}>{chapterButton(id, true)}</span>)}
                </div>}
              </div>
            </Fragment>)}
          </div>
        </section>;
      })}
    </div>
  </div>;
}
