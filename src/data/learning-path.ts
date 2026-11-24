import { agentFrames, apiCallFrames, contextFrames, samplingFrames, toolFrames } from './theater';
import type { TheaterFrame, TheaterSceneId } from './theater';

export type LearningAvailability = 'available' | 'upcoming';
export type LearningStage = '基础主线' | '应用进阶' | '模型原理';

export type PrincipleDefinition = {
  sceneId: TheaterSceneId;
  title: string;
  objective: string;
  version: number;
  requiredFrameIds: readonly string[];
  allowedFrameIds: readonly string[];
  frames: readonly { id: string; title: string }[];
};

export type LearningPathItem = {
  lessonId: string;
  title: string;
  objective: string;
  stage: LearningStage;
  prerequisites: readonly string[];
  principleSceneId?: TheaterSceneId;
  relatedSceneIds: readonly TheaterSceneId[];
  principleAvailability: LearningAvailability;
  practiceAvailability: LearningAvailability;
  upcoming: string | null;
};

export function theaterFrameId(frame: Pick<TheaterFrame, 'phase' | 'round'>): string {
  return frame.round === undefined ? frame.phase : `${frame.phase}:${frame.round}`;
}

function principle(sceneId: TheaterSceneId, title: string, objective: string, frames: TheaterFrame[], branches: TheaterFrame[] = []): PrincipleDefinition {
  const requiredFrameIds = frames.map(theaterFrameId);
  return { sceneId, title, objective, version: 1, requiredFrameIds,
    allowedFrameIds: [...new Set([...requiredFrameIds, ...branches.map(theaterFrameId)])],
    frames: frames.map(frame => ({ id: theaterFrameId(frame), title: frame.title })),
  };
}

export const PRINCIPLE_DEFINITIONS: readonly PrincipleDefinition[] = [
  principle('api-call', 'LLM 调用', '跟踪 messages 的发送与响应解析，区分请求、等待和输出。', apiCallFrames()),
  principle('context', '上下文', '移除一条历史消息，检查本次输入与示例回答发生的变化。', contextFrames(true)),
  principle('tools', '工具调用', '追踪工具名称和参数，区分提出请求、校验、执行和返回结果。', toolFrames(true), toolFrames(false)),
  principle('agent', 'Agent 循环', '追踪工具结果如何进入下一轮，区分正常结束与轮数上限停止。', agentFrames(3), [...agentFrames(1), ...agentFrames(2)]),
  principle('sampling', 'Token 采样', '在固定随机落点下改变温度，比较概率分布与抽样结果。', samplingFrames()),
];

export const LEARNING_PATH: readonly LearningPathItem[] = [
  { lessonId: 'first-call', title: 'LLM 调用', objective: '发送一次模型请求，并从响应对象读取 text 显示结果。', stage: '基础主线', prerequisites: [], principleSceneId: 'api-call', relatedSceneIds: [], principleAvailability: 'available', practiceAvailability: 'available', upcoming: null },
  { lessonId: 'context', title: '上下文', objective: '删除 history 中的一条背景，核对请求内容与回答的变化。', stage: '基础主线', prerequisites: ['first-call'], principleSceneId: 'context', relatedSceneIds: [], principleAvailability: 'available', practiceAvailability: 'available', upcoming: null },
  { lessonId: 'tools', title: '工具调用', objective: '接住模型的工具请求，校验并执行，将参数追踪到计算结果。', stage: '基础主线', prerequisites: ['context'], principleSceneId: 'tools', relatedSceneIds: [], principleAvailability: 'available', practiceAvailability: 'available', upcoming: null },
  { lessonId: 'agent-loop', title: 'Agent 循环', objective: '把工具结果写回下一轮上下文，并验证回答结束与轮数限制。', stage: '基础主线', prerequisites: ['tools'], principleSceneId: 'agent', relatedSceneIds: [], principleAvailability: 'available', practiceAvailability: 'available', upcoming: null },
  { lessonId: 'tokens', title: 'Token 与采样', objective: '理解文本分词，并通过温度与随机落点解释候选如何被选中。', stage: '模型原理', prerequisites: ['first-call'], principleSceneId: 'sampling', relatedSceneIds: [], principleAvailability: 'available', practiceAvailability: 'upcoming', upcoming: '采样原理可看；分词与采样代码实验尚未开放。' },
  { lessonId: 'embeddings', title: '向量与语义检索', objective: '计算向量相似度，检查排序结果是否真正回答了检索问题。', stage: '应用进阶', prerequisites: ['first-call'], relatedSceneIds: [], principleAvailability: 'upcoming', practiceAvailability: 'upcoming', upcoming: '目前可读概念概要；向量原理演示与实操尚未开放。' },
  { lessonId: 'rag', title: 'RAG', objective: '追踪文档切块、检索和引用，检查回答是否得到来源支持。', stage: '应用进阶', prerequisites: ['context', 'embeddings'], relatedSceneIds: ['context'], principleAvailability: 'upcoming', practiceAvailability: 'upcoming', upcoming: '目前可读概念概要；完整 RAG 演示与实操尚未开放。' },
  { lessonId: 'memory', title: '状态与记忆', objective: '区分本次上下文与持久记忆，检查恢复任务时是否重复执行操作。', stage: '应用进阶', prerequisites: ['context', 'agent-loop'], relatedSceneIds: ['context'], principleAvailability: 'upcoming', practiceAvailability: 'upcoming', upcoming: '目前可读概念概要；持久记忆和任务恢复实验尚未开放。' },
  { lessonId: 'evaluation', title: '评测与可靠性', objective: '用同一组案例比较成功率、失败原因、耗时和调用用量。', stage: '应用进阶', prerequisites: ['agent-loop'], relatedSceneIds: [], principleAvailability: 'upcoming', practiceAvailability: 'upcoming', upcoming: '目前可读概念概要；评测演示与实操尚未开放。' },
  { lessonId: 'capstone', title: '综合研究助手', objective: '组合检索、计算与证据引用，并用验收条件检查最终报告。', stage: '应用进阶', prerequisites: ['rag', 'memory', 'evaluation'], relatedSceneIds: ['agent'], principleAvailability: 'upcoming', practiceAvailability: 'upcoming', upcoming: '目前可读项目目标；综合演示与项目实操尚未开放。' },
  { lessonId: 'transformer', title: 'Transformer', objective: '用可检查的小矩阵追踪 Attention 与网络输出，区分教学模型和闭源 API。', stage: '模型原理', prerequisites: ['tokens'], relatedSceneIds: ['sampling'], principleAvailability: 'upcoming', practiceAvailability: 'upcoming', upcoming: '目前可读概念概要；Attention 与网络内部演示尚未开放。' },
  { lessonId: 'training', title: '训练与适配', objective: '观察损失与参数更新，区分训练、Prompt 和 RAG 改变的位置。', stage: '模型原理', prerequisites: ['transformer'], relatedSceneIds: [], principleAvailability: 'upcoming', practiceAvailability: 'upcoming', upcoming: '目前可读概念概要；训练与微调实验尚未开放。' },
  { lessonId: 'mcp', title: 'MCP', objective: '追踪能力发现和工具调用，检查数据权限与失败结果。', stage: '应用进阶', prerequisites: ['tools'], relatedSceneIds: ['tools'], principleAvailability: 'upcoming', practiceAvailability: 'upcoming', upcoming: '目前可读概念概要；MCP 协议演示与接入实验尚未开放。' },
  { lessonId: 'multi-agent', title: '工作流与多 Agent', objective: '明确角色交接数据，用同一任务比较单 Agent 与协作方案。', stage: '应用进阶', prerequisites: ['agent-loop', 'evaluation'], relatedSceneIds: ['agent'], principleAvailability: 'upcoming', practiceAvailability: 'upcoming', upcoming: '目前可读概念概要；多角色协作演示与实操尚未开放。' },
];

export function getLearningPathItem(lessonId: string): LearningPathItem | undefined {
  return LEARNING_PATH.find(item => item.lessonId === lessonId);
}

export function getPrincipleDefinition(sceneId: string): PrincipleDefinition | undefined {
  return PRINCIPLE_DEFINITIONS.find(item => item.sceneId === sceneId);
}
