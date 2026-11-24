import { useCallback, useState } from 'react';
import { getChapterFilm } from '../data/chapter-films';
import ChapterFilm from './ChapterFilm';
import { getChapterReading, recordChapterFrame } from '../lib/chapter-reading';

type Props = { lessonId: string; startFrameId?: string; onFrameChange?: (frameId: string) => void };

export default function ReadChapterFilm({ lessonId, startFrameId, onFrameChange }: Props) {
  const [start] = useState(() => {
    const requested = getChapterFilm(lessonId)?.frames.findIndex(frame => frame.id === startFrameId) ?? -1;
    return requested >= 0 ? requested : getChapterReading(lessonId).last;
  });
  const mark = useCallback((index: number) => recordChapterFrame(lessonId, index), [lessonId]);
  return <ChapterFilm lessonId={lessonId} initialFrame={start} onFrameSeen={mark} onFrameChange={onFrameChange}/>;
}
