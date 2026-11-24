import { useEffect, useId, useRef, useState } from 'react';
import { Button, Empty, Space, Tag, Typography } from 'antd';
import { CaretRightOutlined, CheckOutlined, LeftOutlined, PauseOutlined, ReloadOutlined, RightOutlined } from '@ant-design/icons';
import { clampFilmFrame, getChapterFilm } from '../data/chapter-films';
import type { ChapterFilmDefinition, ChapterFilmFrame, FilmNode, FilmVisual } from '../data/chapter-films';
import { getChapterReading, subscribeChapterReading } from '../lib/chapter-reading';
import './chapter-film.css';

export type ChapterFilmProps = {
  lessonId: string;
  initialFrame?: number;
  onFrameSeen?: (frameIndex: number) => void;
  onFrameChange?: (frameId: string) => void;
  compact?: boolean;
};

const FRAME_MS = 8000;
function textLines(value: string, size = 13): string[] {
  const lines: string[] = [];
  let line = '', width = 0;
  const tokens = value.match(/[A-Za-z_$][\w.$]*|[0-9]+(?:\.[0-9]+)?|\s+|./gu) ?? [];
  for (const token of tokens) {
    const nextWidth = Array.from(token).reduce((total, character) => total + (/[\u0000-\u00ff]/.test(character) ? .6 : 1), 0);
    if (width + nextWidth > size && line) { lines.push(line.trim()); line = ''; width = 0; }
    if (!line && !token.trim()) continue;
    line += token; width += nextWidth;
  }
  if (line) lines.push(line);
  return lines;
}

function connection(from: FilmNode, to: FilmNode, bend = 0) {
  const horizontal = Math.abs(to.x - from.x) >= Math.abs(to.y - from.y);
  const direction = horizontal ? Math.sign(to.x - from.x) : Math.sign(to.y - from.y);
  const x1 = from.x + (horizontal ? direction * 88 : 0);
  const y1 = from.y + (horizontal ? 0 : direction * 43);
  const x2 = to.x - (horizontal ? direction * 94 : 0);
  const y2 = to.y - (horizontal ? 0 : direction * 49);
  return { x1, y1, x2, y2, path: `M ${x1} ${y1} Q ${(x1 + x2) / 2} ${(y1 + y2) / 2 + bend} ${x2} ${y2}` };
}

function FlowDiagram({ film, frame, motion, marker, compact }: { film: ChapterFilmDefinition; frame: ChapterFilmFrame; motion: boolean; marker: string; compact: boolean }) {
  return <>
    {film.links.map((link, index) => {
      const from = film.nodes.find(node => node.id === link.from)!;
      const to = film.nodes.find(node => node.id === link.to)!;
      const active = frame.transfers?.some(item => item.from === from.id && item.to === to.id);
      return <path key={index} className={`chapter-film-wire ${active ? 'is-carrying' : ''}`} d={connection(from, to, link.bend).path} markerEnd={`url(#${marker})`} />;
    })}
    {film.nodes.map(node => <g key={node.id} transform={`translate(${node.x},${node.y})`} className={`chapter-film-node ${frame.active.includes(node.id) ? 'is-active' : ''}`}>
      <rect x="-88" y={compact ? -49 : -43} width="176" height={compact ? 104 : 86} rx="3" />
      <path d="M-88 -13 H88" />
      <text className="chapter-film-node-title" textAnchor="middle" y="-23">{node.label}</text>
      {textLines(frame.values[node.id] ?? '等待', compact ? 8 : 9).map((line, index) => <text key={index} className="chapter-film-node-value" textAnchor="middle" y={9 + index * 20}>{line}</text>)}
      {frame.active.includes(node.id) && <circle cx="77" cy="-32" r="3" className="chapter-film-node-dot" />}
    </g>)}
    {(frame.transfers ?? []).map((transfer, index) => {
      const from = film.nodes.find(node => node.id === transfer.from)!;
      const to = film.nodes.find(node => node.id === transfer.to)!;
      const link = film.links.find(item => item.from === from.id && item.to === to.id);
      const route = connection(from, to, link?.bend);
      return <g key={`${frame.id}:${index}`} className="chapter-film-packet" transform={motion ? undefined : `translate(${route.x2},${route.y2})`}>
        <title>{transfer.label}</title>
        <circle r="8" />
        {motion && <animateMotion dur="2.8s" path={route.path} fill="freeze" />}
      </g>;
    })}
  </>;
}

function TokenDiagram({ visual, motion, compact }: { visual: Extract<FilmVisual, { kind: 'tokens' }>; motion: boolean; compact: boolean }) {
  let offset = 0;
  const total = visual.probabilities.reduce((sum, item) => sum + item, 0);
  const left = compact ? 20 : 70, barX = compact ? 78 : 105, barWidth = compact ? 280 : 495;
  const intervalX = compact ? 100 : 180, intervalWidth = compact ? 350 : 580, intervalY = compact ? 205 : 239;
  return <>
    <text x={left} y="27" className="chapter-film-diagram-label">logits [2, 1, 0] · 温度 {visual.temperature}</text>
    {visual.tokens.map((token, index) => <g key={token} transform={`translate(${left}, ${48 + index * (compact ? 46 : 54)})`}>
      <text className="chapter-film-token" x="0" y="22">{token}</text>
      <rect className="chapter-film-bar-track" x={barX} width={barWidth} height="29" rx="3" />
      <rect className={`chapter-film-probability ${visual.picked === index ? 'is-picked' : ''}`} x={barX} width={barWidth * visual.probabilities[index]} height="29" rx="3">{motion && <animate attributeName="width" from="0" to={barWidth * visual.probabilities[index]} dur="1.4s" fill="freeze" />}</rect>
      <text x={barX + barWidth + 15} y="21" className="chapter-film-number">{total ? `${(visual.probabilities[index] * 100).toFixed(1)}%` : '待计算'}</text>
    </g>)}
    {total > 0 && <>
      <text x={left} y={intervalY + 20} className="chapter-film-small">累计区间</text>
      {visual.probabilities.map((probability, index) => {
        const start = offset; offset += probability;
        return <g key={index}><rect x={intervalX + start * intervalWidth} y={intervalY} width={probability * intervalWidth} height="29" className={`chapter-film-interval interval-${index} ${visual.picked === index ? 'is-picked' : ''}`} />{probability > .12 && <text textAnchor="middle" x={intervalX + (start + probability / 2) * intervalWidth} y={intervalY + 20} className="chapter-film-interval-label">{visual.tokens[index]}</text>}</g>;
      })}
      {visual.threshold !== undefined && <g className="chapter-film-cursor" transform={`translate(${intervalX + visual.threshold * intervalWidth},0)`}><path d={`M0 ${intervalY - 8} V${intervalY + 34}`} /><path d={`M-6 ${intervalY - 15} L6 ${intervalY - 15} L0 ${intervalY - 7} Z`} /><text y={intervalY + 55} textAnchor="middle">u = {visual.threshold.toFixed(1)} → {visual.tokens[visual.picked ?? 0]}</text></g>}
    </>}
  </>;
}

function VectorDiagram({ visual, motion, compact }: { visual: Extract<FilmVisual, { kind: 'vectors' }>; motion: boolean; compact: boolean }) {
  const rows = [{label:'查询', vector:visual.query}, {label:'rag',vector:[1,2,0,0]}, {label:'calculator',vector:[0,0,1,2]}, {label:'mixed',vector:[1,0,0,1]}];
  const x = compact ? 125 : 235, cell = compact ? 48 : 76, rowGap = compact ? 49 : 62, top = compact ? 53 : 76;
  const scoreX = x + cell * 4 + (compact ? 20 : 55);
  return <>
    <text x="20" y="25" className="chapter-film-large-label">同一维度，才能比较</text>
    {['模型','检索','计算','工具'].map((word,index)=><text key={word} x={x + index*cell + cell/2} y={compact ? 46 : 59} textAnchor="middle" className="chapter-film-small">{word}</text>)}
    <text x={scoreX} y={compact ? 46 : 59} className="chapter-film-small">余弦</text>
    {rows.map((row,index)=><g key={row.label} transform={`translate(0,${top + index*rowGap})`}>
      <text x={compact ? 15 : 60} y="25" className="chapter-film-diagram-label">{row.label}</text>
      {row.vector.map((value,column)=><g key={column}><rect x={x+column*cell} width={cell-5} height="35" rx="2" fill={value ? (index===0 ? '#ffe3a0' : '#dbe2ff') : '#ece6d7'} /><text x={x+column*cell+(cell-5)/2} y="24" textAnchor="middle" className="chapter-film-number">{value}</text></g>)}
      {index>0 && <text x={scoreX} y="25" className="chapter-film-number">{visual.ranked ? visual.scores[index-1].toFixed(3) : '—'}</text>}
    </g>)}
    {motion && visual.ranked && rows.slice(1).map((_,index)=><circle key={index} r="5" className="chapter-film-dot"><animateMotion dur="2.1s" path={`M${scoreX-10} ${top+18} L${scoreX-10} ${top+(index+1)*rowGap+18}`} fill="freeze" /></circle>)}
  </>;
}

function AttentionDiagram({ visual, motion, compact }: { visual: Extract<FilmVisual, { kind: 'attention' }>; motion: boolean; compact: boolean }) {
  const weighted = visual.phase !== 'scores';
  const qx = compact ? 70 : 110, qy = compact ? 115 : 155, kx = compact ? 205 : 355, kw = compact ? 125 : 180;
  const ys = compact ? [58,166] : [75,230];
  const scoreX = compact ? 350 : 570;
  const mixed = [visual.weights[0]*10,visual.weights[1]*20];
  return <>
    <circle className="chapter-film-attention-query" cx={qx} cy={qy} r="44" /><text x={qx} y={qy-7} textAnchor="middle" className="chapter-film-node-title">Q</text><text x={qx} y={qy+19} textAnchor="middle" className="chapter-film-diagram-label">[{visual.queryStrength}, 0]</text>
    {ys.map((y,index)=><g key={index}>
      <path className="chapter-film-attention-link" strokeWidth={weighted ? 2+visual.weights[index]*13 : 2} d={`M${qx+44} ${qy} L${kx} ${y}`} />
      <rect x={kx} y={y-28} width={kw} height="64" className="chapter-film-attention-cell" rx="3" />
      <text x={kx+kw/2} y={y-5} textAnchor="middle" className="chapter-film-diagram-label">K{index+1} = [{index===0 ? 1 : '−1'},0]</text>
      <text x={kx+kw/2} y={y+20} textAnchor="middle" className="chapter-film-diagram-label">V{index+1} = {index===0 ? '[10,0]' : '[0,20]'}</text>
      <text x={scoreX} y={y+5} className="chapter-film-number">{weighted ? `${(visual.weights[index]*100).toFixed(1)}%` : `${((index===0 ? 1 : -1)*visual.queryStrength/Math.sqrt(2)).toFixed(3)}`}</text>
      {motion && weighted && <circle r={4+visual.weights[index]*6} className="chapter-film-dot"><animateMotion dur="2.2s" path={`M${kx} ${y} L${qx+44} ${qy}`} fill="freeze" /></circle>}
    </g>)}
    {visual.phase==='sum' && <text x={compact ? 250 : 450} y={compact ? 252 : 324} textAnchor="middle" className="chapter-film-number">Σ 权重 × V = [{mixed.map(value=>value.toFixed(3)).join(', ')}]</text>}
  </>;
}

function TrainingDiagram({ visual, motion, compact }: { visual: Extract<FilmVisual, { kind: 'training' }>; motion: boolean; compact: boolean }) {
  const domain = visual.weight>4 ? 8 : 4, maxLoss = visual.weight>4 ? 100 : 12;
  const left = compact ? 35 : 90, bottom = compact ? 223 : 270, width = compact ? 230 : 400, chartHeight = compact ? 165 : 215;
  const point = (weight:number) => ({x:left+weight/domain*width,y:bottom-2.5*(weight-2)**2/maxLoss*chartHeight});
  const curve=Array.from({length:41},(_,index)=>{const p=point(index/40*domain);return `${index?'L':'M'}${p.x} ${p.y}`;}).join(' ');
  const current=point(visual.weight), previous=point(0), textX=compact?300:570;
  return <>
    <path className="chapter-film-axis" d={`M${left-10} 30 V${bottom} H${left+width+8}`} /><text x={left-10} y="23" className="chapter-film-small">MSE</text>
    <path d={curve} className="chapter-film-loss-curve" />
    {[0,domain/2,domain].map(weight=><text key={weight} x={point(weight).x} y={bottom+23} textAnchor="middle" className="chapter-film-small">w={weight}</text>)}
    <circle cx={previous.x} cy={previous.y} r="6" className="chapter-film-old-weight" />
    {visual.updated && <path d={`M${previous.x} ${previous.y} L${current.x} ${current.y}`} className="chapter-film-update-line" />}
    <circle cx={motion&&visual.updated?0:current.x} cy={motion&&visual.updated?0:current.y} r="8" className="chapter-film-current-weight">{motion&&visual.updated&&<animateMotion dur="2s" path={`M${previous.x} ${previous.y} L${current.x} ${current.y}`} fill="freeze" />}</circle>
    <text x={textX} y="57" className="chapter-film-large-label">一次参数更新</text>
    <text x={textX} y="99" className="chapter-film-diagram-label">w = {visual.weight}</text>
    <text x={textX} y="140" className="chapter-film-number">预测 [{visual.predictions.join(', ')}]</text>
    <text x={textX} y="182" className="chapter-film-equation">损失 {visual.loss}</text>
    <text x={textX} y="220" className="chapter-film-small">学习率 {visual.learningRate} · 梯度 −10</text>
    <text x={textX} y={compact ? 250 : 284} className="chapter-film-small">L = 2.5(w − 2)²</text>
  </>;
}

function EvaluationDiagram({ visual, compact }: { visual: Extract<FilmVisual, { kind: 'evaluation' }>; compact: boolean }) {
  const cases=['17 × 23','1.25 × 2','0 × 9'],expected=[391,2.5,0];
  const passed=visual.results.filter(result=>result==='pass').length,pending=visual.results.some(result=>result==='pending');
  const left=compact?15:55,width=compact?470:790,columns=compact?[25,180,290,390]:[65,320,530,690],top=compact?104:115,gap=compact?48:62;
  return <>
    <text x={left} y="29" className="chapter-film-large-label">{visual.variant}</text>
    <text x={left+width} y="57" textAnchor="end" className="chapter-film-number">{pending?'尚未评测':`${passed}/3 通过`}</text>
    <path className="chapter-film-table-rule" d={`M${left} 68 H${left+width}`} />
    {['固定输入','期望','实际','结果'].map((heading,index)=><text key={heading} x={columns[index]} y="92" className="chapter-film-small">{heading}</text>)}
    {cases.map((item,index)=><g key={item} transform={`translate(0,${top+index*gap})`}>
      <rect x={left} width={width} height={gap-5} className={`chapter-film-evaluation-row is-${visual.results[index]}`} />
      <text x={columns[0]} y="29" className="chapter-film-diagram-label">{item}</text><text x={columns[1]} y="29" className="chapter-film-diagram-label">{expected[index]}</text><text x={columns[2]} y="29" className="chapter-film-number">{visual.actual[index]??'—'}</text>
      <text x={columns[3]} y="29" className={`chapter-film-evaluation-result is-${visual.results[index]}`}>{visual.results[index]==='pending'?'未测':visual.results[index]==='pass'?'✓ 通过':'× 失败'}</text>
    </g>)}
  </>;
}

function FilmDiagram({ film, frame, playing, reducedMotion, compact, strip }: { film: ChapterFilmDefinition; frame: ChapterFilmFrame; playing: boolean; reducedMotion: boolean; compact: boolean; strip: boolean }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const lastSvg = useRef<SVGSVGElement | null>(null);
  const marker = `film-arrow-${useId().replace(/:/g, '')}`;
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    if (svg !== lastSvg.current) {
      svg.setCurrentTime?.(playing ? 0 : 3);
      lastSvg.current = svg;
    }
    if (playing && !reducedMotion) {
      if ((svg.getCurrentTime?.() ?? 0) >= 3) svg.setCurrentTime?.(0);
      svg.unpauseAnimations?.();
    }
    else svg.pauseAnimations?.();
  }, [playing, reducedMotion, frame.id, compact, strip]);
  const visual = frame.visual;
  const activeNodes = film.nodes.filter(node => frame.active.includes(node.id));
  const focusedNodes = activeNodes.length > 2 ? [activeNodes[0], activeNodes[activeNodes.length - 1]] : activeNodes.length ? activeNodes : film.nodes.slice(0, 2);
  const diagramFilm = strip && !visual ? { ...film,
    nodes: focusedNodes.map((node, nodeIndex) => ({ ...node, x: focusedNodes.length === 1 ? 350 : 150 + nodeIndex * 400, y: 85 })),
    links: film.links.filter(link => focusedNodes.some(node => node.id === link.from) && focusedNodes.some(node => node.id === link.to)).map(link => ({ ...link, bend: 0 })),
  } : compact ? { ...film, nodes: film.nodes.map((node, nodeIndex) => ({ ...node, x: [110,390,390,110][nodeIndex], y: nodeIndex < 2 ? 55 : 185 })), links: film.links.map(link => ({ ...link, bend: 0 })) } : film;
  const diagramFrame = strip && !visual ? { ...frame, transfers: frame.transfers?.filter(transfer => diagramFilm.nodes.some(node => node.id === transfer.from) && diagramFilm.nodes.some(node => node.id === transfer.to)) } : frame;
  const viewBox = strip && !visual ? '0 0 700 170' : compact ? `0 0 500 ${visual ? 270 : 250}` : '0 0 900 340';
  return <svg ref={svgRef} key={`${frame.id}:${compact}:${strip}`} className={`chapter-film-diagram ${compact ? 'is-compact-diagram' : ''} ${reducedMotion ? 'is-reduced' : ''}`} viewBox={viewBox} preserveAspectRatio="xMidYMin meet" role="img" aria-labelledby={`${marker}-title ${marker}-description`}>
    <title id={`${marker}-title`}>{frame.action}</title><desc id={`${marker}-description`}>{frame.cause} {Object.entries(frame.values).map(([key, value]) => `${film.nodes.find(node => node.id === key)?.label}: ${value}`).join('；')}</desc>
    <defs><marker id={marker} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0 L8 4 L0 8 Z" fill="currentColor" /></marker></defs>
    {!visual && <FlowDiagram film={diagramFilm} frame={diagramFrame} motion={!reducedMotion} marker={marker} compact={compact} />}
    {visual?.kind === 'tokens' && <TokenDiagram visual={visual} motion={!reducedMotion} compact={compact} />}
    {visual?.kind === 'vectors' && <VectorDiagram visual={visual} motion={!reducedMotion} compact={compact} />}
    {visual?.kind === 'attention' && <AttentionDiagram visual={visual} motion={!reducedMotion} compact={compact} />}
    {visual?.kind === 'training' && <TrainingDiagram visual={visual} motion={!reducedMotion} compact={compact} />}
    {visual?.kind === 'evaluation' && <EvaluationDiagram visual={visual} compact={compact} />}
  </svg>;
}

function FilmPlayer({ film, initialFrame, onFrameSeen, onFrameChange, compact = false }: { film: ChapterFilmDefinition } & Omit<ChapterFilmProps, 'lessonId'>) {
  const [index, setIndex] = useState(() => clampFilmFrame(initialFrame, film.frames.length));
  const [playing, setPlaying] = useState(false);
  const [replayEpoch, setReplayEpoch] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  const [inView, setInView] = useState(false);
  const [narrow, setNarrow] = useState(compact);
  const [diagramNarrow, setDiagramNarrow] = useState(compact);
  const [seen, setSeen] = useState(() => new Set(getChapterReading(film.lessonId).seen));
  const containerRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const detailsRef = useRef<HTMLDivElement>(null);
  const callbackRef = useRef(onFrameSeen);
  const changeRef = useRef(onFrameChange);
  const lastReported = useRef<number | null>(null);
  callbackRef.current = onFrameSeen;
  changeRef.current = onFrameChange;
  const frame = film.frames[index];
  const isCompact = compact || narrow;

  useEffect(() => {
    changeRef.current?.(frame.id);
    if (detailsRef.current) detailsRef.current.scrollTop = 0;
  }, [frame.id]);

  useEffect(() => subscribeChapterReading(() => {
    setSeen(previous => new Set([...previous, ...getChapterReading(film.lessonId).seen]));
  }), [film.lessonId]);

  useEffect(() => {
    const target = containerRef.current;
    if (!target) return;
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        if (entry.target === target) setNarrow(entry.contentRect.width < 850);
        else setDiagramNarrow(entry.contentRect.width < 820);
      }
    });
    observer.observe(target);
    if (stageRef.current) observer.observe(stageRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onPreference = () => setReducedMotion(preference.matches);
    const onVisibility = () => { const next = document.visibilityState === 'visible'; setVisible(next); if (!next) setPlaying(false); };
    onPreference();
    preference.addEventListener('change', onPreference);
    document.addEventListener('visibilitychange', onVisibility);
    return () => { preference.removeEventListener('change', onPreference); document.removeEventListener('visibilitychange', onVisibility); };
  }, []);

  useEffect(() => {
    const target = stageRef.current;
    if (!target) return;
    const observer = new IntersectionObserver(entries => {
      const next = entries.some(entry => entry.isIntersecting && entry.intersectionRatio >= .5);
      setInView(next);
      if (!next) setPlaying(false);
    }, { threshold: [0, .5] });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!playing || !visible || !inView) return;
    const timer = window.setTimeout(() => {
      if (index === film.frames.length - 1) setPlaying(false);
      else setIndex(value => value + 1);
    }, FRAME_MS);
    return () => window.clearTimeout(timer);
  }, [playing, visible, inView, index, film.frames.length]);

  useEffect(() => {
    if (!visible || !inView || lastReported.current === index) return;
    const timer = window.setTimeout(() => {
      if (document.visibilityState !== 'visible') return;
      lastReported.current = index;
      setSeen(previous => new Set([...previous, index]));
      callbackRef.current?.(index);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [visible, inView, index]);

  const step = (difference: number) => { setPlaying(false); setIndex(value => clampFilmFrame(value + difference, film.frames.length)); };
  const selectFrame = (next: number) => { setPlaying(false); setIndex(next); };
  const restart = () => { setIndex(0); setReplayEpoch(value => value + 1); setPlaying(true); };
  const toggle = () => { if (!playing && index === film.frames.length - 1) setIndex(0); setPlaying(value => !value); };
  return <section ref={containerRef} className={`chapter-film ${isCompact ? 'is-compact' : ''}`} aria-label={`${film.title}，教学动图`} data-testid="chapter-film" data-lesson-id={film.lessonId} data-frame-id={frame.id}>
    <header className="chapter-film-heading">
      <div><Typography.Title level={3}>{film.question}</Typography.Title><Tag variant="filled">教学例子 · 不运行代码</Tag></div>
      <Typography.Text className="chapter-film-goal"><strong>看完能做</strong>{film.goal}</Typography.Text>
    </header>
    <nav className="chapter-film-scenes" aria-label="本章分镜，按顺序查看或点击跳转">
      <ol style={{ gridTemplateColumns: `repeat(${film.frames.length}, minmax(0, 1fr))` }}>
        {film.frames.map((item, frameIndex) => <li key={item.id}>
          <Button type={frameIndex === index ? 'primary' : 'default'} block onClick={() => selectFrame(frameIndex)} aria-current={frameIndex === index ? 'step' : undefined} aria-label={`第 ${frameIndex + 1} 步，${item.title}，${frameIndex === index ? '当前，' : ''}${seen.has(frameIndex) ? '已浏览' : '未浏览'}`} data-testid={`film-scene-${item.id}`}>
            <span className="chapter-film-scene-number">{frameIndex + 1}</span><span>{item.title}</span>{seen.has(frameIndex) && <CheckOutlined className="chapter-film-scene-read" aria-label="已浏览" />}
          </Button>
        </li>)}
      </ol>
    </nav>
    <div className="chapter-film-reading">
      <div ref={detailsRef} className="chapter-film-details" tabIndex={0} aria-label="当步说明与参数，可独立滚动">
        <div className="chapter-film-explanation" aria-live="polite" aria-atomic="true">
          <span className="chapter-film-step-number">{String(index + 1).padStart(2, '0')}</span>
          <div><span className="chapter-film-explanation-label">这一步发生什么</span><Typography.Title level={4}>{frame.action}</Typography.Title><Typography.Paragraph><strong className="chapter-film-why">为什么</strong>{frame.cause}</Typography.Paragraph></div>
        </div>
        <dl className="chapter-film-evidence">{frame.evidence.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
        <Typography.Paragraph className="chapter-film-note">{film.note}</Typography.Paragraph>
      </div>
      <div ref={stageRef} className="chapter-film-stage" data-testid="chapter-film-stage">
        <div className="chapter-film-stage-caption">{isCompact && !frame.visual ? '本步焦点' : '数据与状态'}{frame.transfers?.length ? ` · 传递：${frame.transfers.map(item => item.label).join('、')}` : ''}</div>
        <FilmDiagram key={replayEpoch} film={film} frame={frame} playing={playing && visible && inView} reducedMotion={reducedMotion} compact={isCompact || diagramNarrow} strip={isCompact} />
      </div>
    </div>
    <footer className="chapter-film-controls">
      <div className="chapter-film-control-row">
        <Space size={8} wrap>
          <Button icon={<LeftOutlined />} onClick={() => step(-1)} disabled={index === 0} aria-label="上一步">上一步</Button>
          <Button type="primary" icon={playing ? <PauseOutlined /> : <CaretRightOutlined />} onClick={toggle}>{playing ? '暂停' : index === film.frames.length - 1 ? '重新播放' : '播放'}</Button>
          <Button icon={<RightOutlined />} onClick={() => step(1)} disabled={index === film.frames.length - 1} aria-label="下一步">下一步</Button>
          <Button type="text" icon={<ReloadOutlined />} onClick={restart}>重播</Button>
        </Space>
        <div className="chapter-film-progress-labels"><Typography.Text className="chapter-film-position">当前 {index + 1} / {film.frames.length}</Typography.Text><Typography.Text className="chapter-film-read-progress">已浏览 {seen.size} / {film.frames.length}</Typography.Text>{reducedMotion && <Typography.Text className="chapter-film-motion-note">减少动效</Typography.Text>}</div>
      </div>
    </footer>
  </section>;
}

export default function ChapterFilm({ lessonId, initialFrame, onFrameSeen, onFrameChange, compact }: ChapterFilmProps) {
  const film = getChapterFilm(lessonId);
  if (!film) return <Empty description="这一章还没有原理动图" />;
  return <FilmPlayer key={`${lessonId}:${film.version}`} film={film} initialFrame={initialFrame} onFrameSeen={onFrameSeen} onFrameChange={onFrameChange} compact={compact} />;
}
