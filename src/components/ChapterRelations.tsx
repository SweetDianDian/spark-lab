import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Typography } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import { BaseEdge, getBezierPath, Position } from '@xyflow/react';

export type RelationChapter = { id: string; title: string; number: number };
type Link = { id: string; path: string; outgoing: boolean };

type Props = {
  chapter: RelationChapter;
  before: RelationChapter[];
  after: RelationChapter[];
  actions: ReactNode;
  onSelect: (id: string) => void;
  onDetails: () => void;
};

/** Measure the rendered cards so arrows stay attached when names wrap or the details pane opens. */
export default function ChapterRelations({ chapter, before, after, actions, onSelect, onDetails }: Props) {
  const graph = useRef<HTMLDivElement>(null);
  const prefix = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [links, setLinks] = useState<Link[]>([]);
  useLayoutEffect(() => {
    const board = graph.current;
    if (!board) return;
    const current = board.querySelector<HTMLElement>('[data-current-chapter]')!;
    const neighbors = Array.from(board.querySelectorAll<HTMLElement>('[data-neighbor]'));
    const draw = () => {
      const bounds = board.getBoundingClientRect();
      const center = current.getBoundingClientRect();
      const next = neighbors.map(card => {
        const box = card.getBoundingClientRect();
        const outgoing = card.dataset.neighbor === 'after';
        const groupSize = Number(card.dataset.count);
        const fraction = (Number(card.dataset.index) + 1) / (groupSize + 1);
        const portY = center.top + center.height * fraction;
        const cardY = box.top + box.height / 2;
        const [path] = getBezierPath({
          sourcePosition: Position.Right, targetPosition: Position.Left,
          sourceX: (outgoing ? center.right : box.right) - bounds.left,
          sourceY: (outgoing ? portY : cardY) - bounds.top,
          targetX: (outgoing ? box.left : center.left) - bounds.left - 3,
          targetY: (outgoing ? cardY : portY) - bounds.top,
        });
        return { id: card.dataset.chapterId!, path, outgoing };
      });
      setLinks(next);
    };
    draw();
    const observer = new ResizeObserver(draw);
    [board, current, ...neighbors].forEach(element => observer.observe(element));
    return () => observer.disconnect();
  }, [chapter.id]);

  function neighbors(list: RelationChapter[], side: 'before' | 'after') {
    const label = side === 'before' ? '先学这几章' : '接着可以学';
    return <div className="relation-lane" role="group" aria-label={label}>
      <Typography.Text className="relation-lane-title">{side === 'before' ? '建议先学' : '接着可以学'}</Typography.Text>
      {list.length ? list.map((entry, index) => (
        <Button key={entry.id} className="relation-neighbor" data-neighbor={side} data-index={index}
          data-count={list.length} data-chapter-id={entry.id} onClick={() => onSelect(entry.id)}>
          <span className="relation-number">{String(entry.number).padStart(2, '0')}</span>
          <strong>{entry.title}</strong>
        </Button>
      )) : <Typography.Text className="relation-empty">{side === 'before' ? '这章可以直接开始' : '这条路线学到这里'}</Typography.Text>}
    </div>;
  }

  return <div className="chapter-relations" role="region" aria-label={chapter.title + '的直接先修与后续章节'}>
    <div className="relation-board" ref={graph}>
      <svg className="relation-arrows" aria-hidden="true">
        <defs>{['before', 'after'].map(side => <marker key={side} id={prefix + side} viewBox="0 0 12 12" refX="10" refY="6"
          markerWidth="11" markerHeight="11" markerUnits="userSpaceOnUse" orient="auto">
          <path d="M 1 1 L 11 6 L 1 11 Z" fill={side === 'before' ? 'var(--relation-in)' : 'var(--atlas-blue)'}/>
        </marker>)}</defs>
        {links.map(link => <BaseEdge key={link.id} id={prefix + link.id} path={link.path} interactionWidth={0}
          style={{ fill: 'none', stroke: link.outgoing ? 'var(--atlas-blue)' : 'var(--relation-in)', strokeWidth: 2.5 }}
          markerEnd={'url(#' + prefix + (link.outgoing ? 'after' : 'before') + ')'}/>)}
      </svg>
      {neighbors(before, 'before')}
      <div className="relation-center" data-current-chapter={chapter.id} tabIndex={-1} role="group" aria-label={'当前章节 ' + chapter.title}>
        <div className="relation-current-meta"><Typography.Text>当前章节 · {String(chapter.number).padStart(2, '0')}</Typography.Text>
          <Button type="text" className="relation-info" size="small" icon={<InfoCircleOutlined/>} onClick={onDetails} aria-label="章节详情" title="章节详情"/>
        </div>
        <Typography.Title level={2}>{chapter.title}</Typography.Title>
        {actions}
      </div>
      {neighbors(after, 'after')}
    </div>
  </div>;
}
