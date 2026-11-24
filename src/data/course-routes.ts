import { getLearningSections, type LearningPathItem } from './learning-path';

export type CourseRouteStep = {
  lessonId: string;
  /** Prerequisites not represented by the preceding step's horizontal arrow. */
  extraPrerequisites: string[];
};

export type CourseRoute = {
  /** The first lesson is the stable identity of this row. */
  id: string;
  sectionId: string;
  title: string;
  steps: CourseRouteStep[];
};

type RouteSection = {
  id: string;
  lessons: readonly Pick<LearningPathItem, 'lessonId' | 'title' | 'prerequisites'>[];
};

const routeTitles: Record<string, string> = {
  'first-call': '调用与执行',
  tokens: '模型原理',
  embeddings: '资料检索',
  memory: '状态恢复',
  mcp: '工具接入',
  evaluation: '评测与协作',
  capstone: '综合项目',
};

/**
 * Keep catalogue order and section boundaries. A horizontal arrow is permitted
 * only when the next lesson explicitly requires the immediately previous one.
 * Every other prerequisite stays attached to its own lesson as an extra link.
 */
export function getCourseRoutes(sections: readonly RouteSection[] = getLearningSections()): CourseRoute[] {
  const routes: CourseRoute[] = [];
  for (const section of sections) {
    let row: CourseRoute | undefined;
    for (const lesson of section.lessons) {
      const previous = row?.steps.at(-1)?.lessonId;
      const continues = previous !== undefined && lesson.prerequisites.includes(previous);
      if (!continues) {
        row = { id: lesson.lessonId, sectionId: section.id,
          title: Object.hasOwn(routeTitles, lesson.lessonId) ? routeTitles[lesson.lessonId] : lesson.title,
          steps: [] };
        routes.push(row);
      }
      row!.steps.push({ lessonId: lesson.lessonId,
        extraPrerequisites: lesson.prerequisites.filter(id => !continues || id !== previous) });
    }
  }
  return routes;
}
