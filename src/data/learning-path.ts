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
  leadIn?: string;
  stage: LearningStage;
  prerequisites: readonly string[];
  /** Optional deep A/B demonstration; separate from the chapter's own animation. */
  principleSceneId?: TheaterSceneId;
  relatedSceneIds: readonly TheaterSceneId[];
  /** Availability of the registered deep A/B scene, not of chapter animations. */
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
  { lessonId: 'first-call', title: 'LLM 调用', objective: '发送一次模型请求，从响应对象读取 text，并把回答显示出来。', leadIn: '先让程序接住一个问题、拿到一份回答，后面的背景、工具和循环才有接入的位置。', stage: '基础主线', prerequisites: [], principleSceneId: 'api-call', relatedSceneIds: [], principleAvailability: 'available', practiceAvailability: 'available', upcoming: null },
  { lessonId: 'context', title: '上下文', objective: '只移除 history 背景，核对本次请求消息与回答的变化。', leadIn: '助手已经能回答了；现在把读者的背景带进去，看看本次输入怎样影响解释。', stage: '基础主线', prerequisites: ['first-call'], principleSceneId: 'context', relatedSceneIds: [], principleAvailability: 'available', practiceAvailability: 'available', upcoming: null },
  { lessonId: 'tools', title: '工具调用', objective: '接住模型的工具请求，校验并执行，把人数和单价追踪到总费用。', leadIn: '会按背景解释之后，遇到算数问题还要把请求交给程序，让计算真正发生。', stage: '基础主线', prerequisites: ['context'], principleSceneId: 'tools', relatedSceneIds: [], principleAvailability: 'available', practiceAvailability: 'available', upcoming: null },
  { lessonId: 'agent-loop', title: 'Agent 循环', objective: '把工具结果带回下一轮，区分生成最终回答和达到轮数上限。', leadIn: '一次工具调用已经跑通；下一步把返回结果带进后续轮次，继续完成多步任务。', stage: '基础主线', prerequisites: ['tools'], principleSceneId: 'agent', relatedSceneIds: [], principleAvailability: 'available', practiceAvailability: 'available', upcoming: null },
  { lessonId: 'tokens', title: 'Token 与采样', objective: '用小词表切分文本，固定采样落点，计算温度改变后的候选概率与结果。', leadIn: '前面把模型当作可调用的服务；现在拆开生成这一环，看看文字怎样切分、候选怎样选出。', stage: '模型原理', prerequisites: ['first-call'], principleSceneId: 'sampling', relatedSceneIds: [], principleAvailability: 'available', practiceAvailability: 'available', upcoming: null },
  { lessonId: 'transformer', title: 'Transformer', objective: '计算二维单头 Attention 的权重与加权结果，观察查询方向的影响。', leadIn: '知道模型逐个选择 Token 后，再看一次 Attention 怎样从不同输入位置汇总信息。', stage: '模型原理', prerequisites: ['tokens'], relatedSceneIds: ['sampling'], principleAvailability: 'upcoming', practiceAvailability: 'available', upcoming: null },
  { lessonId: 'training', title: '训练与适配', objective: '给单参数线性模型做一步梯度更新，比较不同学习率带来的损失变化。', leadIn: '看过模型中的数值计算后，用一个更小的线性模型理解参数怎样被误差推动。', stage: '模型原理', prerequisites: ['transformer'], relatedSceneIds: [], principleAvailability: 'upcoming', practiceAvailability: 'available', upcoming: null },
  { lessonId: 'embeddings', title: '向量与语义检索', objective: '用词频生成可检查的向量，计算余弦相似度并排序，不假定已有语义能力。', leadIn: '看过计算与训练，再回到助手需要的资料：先把文本变成可比较的向量，尝试寻找相关内容。', stage: '应用进阶', prerequisites: ['first-call'], relatedSceneIds: [], principleAvailability: 'upcoming', practiceAvailability: 'available', upcoming: null },
  { lessonId: 'rag', title: 'RAG', objective: '从本地片段检索资料，组装带来源的上下文和证据摘录，不调用生成模型。', leadIn: '能给资料排序后，把取回的原文和来源编号放进回答依据，而不只报一个相关分数。', stage: '应用进阶', prerequisites: ['context', 'embeddings'], relatedSceneIds: ['context'], principleAvailability: 'upcoming', practiceAvailability: 'available', upcoming: null },
  { lessonId: 'memory', title: '状态与记忆', objective: '在一次运行内序列化并恢复账本，检查丢失完成标记为何导致重复记账。', leadIn: '资料能够找到了，任务却可能中断；用状态快照演练恢复，检查哪些操作不能重复执行。', stage: '应用进阶', prerequisites: ['context', 'agent-loop'], relatedSceneIds: ['context'], principleAvailability: 'upcoming', practiceAvailability: 'available', upcoming: null },
  { lessonId: 'mcp', title: 'MCP', objective: '用本地函数模拟能力发现和工具调用，区分能力清单、调用策略与执行结果。', leadIn: '知道任务要保存哪些状态后，再整理工具的接入约定：先发现能力，再按接口传递参数。', stage: '应用进阶', prerequisites: ['tools'], relatedSceneIds: ['tools'], principleAvailability: 'upcoming', practiceAvailability: 'available', upcoming: null },
  { lessonId: 'evaluation', title: '评测与可靠性', objective: '运行固定计算案例，按容差统计通过率，并保留每个失败样本。', leadIn: '工具能按约定调用，不等于每次结果都对；固定一组案例，逐条检查实际输出。', stage: '应用进阶', prerequisites: ['agent-loop'], relatedSceneIds: [], principleAvailability: 'upcoming', practiceAvailability: 'available', upcoming: null },
  { lessonId: 'multi-agent', title: '工作流与多 Agent', objective: '让两个本地角色函数交接结构化证据，核验来源缺失与金额不一致。', leadIn: '有了明确的验收规则，再让两个角色交接证据，看看核验者为什么接受或退回。', stage: '应用进阶', prerequisites: ['agent-loop', 'evaluation'], relatedSceneIds: ['agent'], principleAvailability: 'upcoming', practiceAvailability: 'available', upcoming: null },
  { lessonId: 'capstone', title: '综合研究助手', objective: '组合本地资料选择、费用计算和预算检查，输出带引用的活动费用报告。', leadIn: '把检索、计算和核验连起来，用一份带来源的费用报告检验这条学习路线。', stage: '应用进阶', prerequisites: ['rag', 'tools', 'evaluation'], relatedSceneIds: ['agent'], principleAvailability: 'upcoming', practiceAvailability: 'available', upcoming: null },
];


/** Section boundaries keep the catalogue in the exact LEARNING_PATH order. */
export const LEARNING_SECTIONS = [
  { id: 'getting-started', title: '让助手先做起来', startLessonId: 'first-call' },
  { id: 'model-internals', title: '模型是怎么工作的', startLessonId: 'tokens' },
  { id: 'building-assistant', title: '构建自己的助手', startLessonId: 'embeddings' },
  { id: 'project', title: '把能力串成一个项目', startLessonId: 'capstone' },
] as const;

export function getLearningSections() {
  return LEARNING_SECTIONS.map((section, index) => {
    const start = LEARNING_PATH.findIndex(item => item.lessonId === section.startLessonId);
    const next = LEARNING_SECTIONS[index + 1];
    const end = next ? LEARNING_PATH.findIndex(item => item.lessonId === next.startLessonId) : LEARNING_PATH.length;
    return { ...section, startIndex: start, lessons: LEARNING_PATH.slice(start, end) };
  });
}

export function getLearningPathItem(lessonId: string): LearningPathItem | undefined {
  return LEARNING_PATH.find(item => item.lessonId === lessonId);
}

export function getPrincipleDefinition(sceneId: string): PrincipleDefinition | undefined {
  return PRINCIPLE_DEFINITIONS.find(item => item.sceneId === sceneId);
}
