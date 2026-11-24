import { memo, useEffect, useMemo, type ReactNode } from 'react';
import { Card, Flex, Tag, Typography, theme } from 'antd';
import { Background, Controls, Handle, MarkerType, Panel, Position, ReactFlow, useNodesInitialized, useReactFlow, type Node, type NodeProps, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './learning-diagram.css';

export type DiagramNode = {
  id: string;
  title: string;
  subtitle?: string;
  detail?: ReactNode;
  state?: 'idle' | 'active' | 'done' | 'error';
  position?: { x: number; y: number };
  dimmed?: boolean;
};
export type DiagramEdge = { source: string; target: string; label?: string; emphasis?: boolean; dashed?: boolean };
type LearningNode = Node<DiagramNode & { width: number; highlighted: boolean }, 'learning'>;

const LessonNode = memo(function LessonNode({ data, selected }: NodeProps<LearningNode>) {
  const { token } = theme.useToken();
  const active = selected || data.highlighted;
  return <>
    <Handle type="target" position={Position.Left} isConnectable={false}/>
    <Card size="small" className="diagram-node-card" styles={{ body: { padding: 16 } }} style={{ width: data.width, borderColor: active ? token.colorPrimary : token.colorBorderSecondary, background: active ? token.colorPrimaryBg : token.colorBgContainer, opacity: data.dimmed ? 0.42 : 1 }}>
      <Flex vertical gap={8}>
        <Typography.Text strong>{data.title}</Typography.Text>
        {data.subtitle && <Typography.Text type="secondary">{data.subtitle}</Typography.Text>}
        {data.state && data.state !== 'idle' && <Tag color={data.state === 'error' ? 'error' : data.state === 'done' ? 'success' : 'processing'} style={{ alignSelf: 'flex-start', margin: 0 }}>{data.state === 'error' ? '失败' : data.state === 'done' ? '已完成' : '当前步骤'}</Tag>}
        {data.detail}
      </Flex>
    </Card>
    <Handle type="source" position={Position.Right} isConnectable={false}/>
  </>;
});
const nodeTypes = { learning: LessonNode };

function FitDiagram({ layoutKey }: { layoutKey: string }) {
  const initialized = useNodesInitialized();
  const { fitView } = useReactFlow();
  useEffect(() => { if (initialized) void fitView({ padding: 0.12, maxZoom: 1, duration: 0 }); }, [initialized, fitView, layoutKey]);
  return null;
}

/** Library-backed diagram used by curriculum, principles and actual run traces. */
export default function LearningDiagram({ nodes, edges, height = 240, nodeWidth = 200, selectedId, onSelect, controls = false, ariaLabel = '学习流程图' }: {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  height?: number;
  nodeWidth?: number;
  selectedId?: string;
  onSelect?: (id: string) => void;
  controls?: boolean;
  ariaLabel?: string;
}) {
  const { token } = theme.useToken();
  const diagramNodes = useMemo<LearningNode[]>(() => nodes.map((node, index) => ({
    id: node.id, type: 'learning', position: node.position ?? { x: index * (nodeWidth + 48), y: 20 },
    data: { ...node, width: nodeWidth, highlighted: node.id === selectedId },
    selected: node.id === selectedId, draggable: false, selectable: !!onSelect,
    ariaLabel: `${node.title}${node.subtitle ? `，${node.subtitle}` : ''}`,
  })), [nodes, nodeWidth, selectedId, onSelect]);
  const diagramEdges = useMemo<Edge[]>(() => edges.map((edge, index) => ({
    id: `${edge.source}-${edge.target}-${index}`, source: edge.source, target: edge.target,
    type: 'smoothstep', label: edge.label,
    markerEnd: { type: MarkerType.ArrowClosed, color: edge.emphasis ? token.colorPrimary : token.colorTextQuaternary },
    style: { stroke: edge.emphasis ? token.colorPrimary : token.colorTextQuaternary, strokeWidth: edge.emphasis ? 2 : 1.5, strokeDasharray: edge.dashed ? '5 5' : undefined },
    labelStyle: { fill: token.colorTextSecondary, fontSize: 12 }, labelBgStyle: { fill: token.colorBgLayout },
  })), [edges, token.colorPrimary, token.colorTextQuaternary, token.colorTextSecondary, token.colorBgLayout]);
  const layoutKey = nodes.map(node => `${node.id}:${node.position?.x ?? ''}:${node.position?.y ?? ''}`).join('|') + ':' + nodeWidth;
  return <div className="learning-diagram" style={{ height }} role="region" aria-label={ariaLabel}>
    <ReactFlow nodes={diagramNodes} edges={diagramEdges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.12, maxZoom: 1 }} minZoom={0.2} maxZoom={1.5}
      nodesDraggable={false} nodesConnectable={false} edgesReconnectable={false} elementsSelectable={!!onSelect} nodesFocusable={!!onSelect}
      onNodeClick={(_, node) => onSelect?.(node.id)}
      onNodesChange={changes => { const selection = changes.toArray().find(change => change.type === 'select' && change.selected); if (selection?.type === 'select') onSelect?.(selection.id); }}
      deleteKeyCode={null} panOnDrag={controls} zoomOnScroll={controls} zoomOnDoubleClick={false} zoomOnPinch={controls} preventScrolling={controls}>
      <Background color={token.colorBorderSecondary} gap={22} size={1}/>
      {controls && <Controls showInteractive={false} aria-label="流程图缩放控制"/>}
      {controls && <Panel position="top-right"><Tag>图内滚轮缩放 · 拖拽平移</Tag></Panel>}
      <FitDiagram layoutKey={layoutKey}/>
    </ReactFlow>
  </div>;
}
