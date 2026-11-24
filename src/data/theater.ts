export type TheaterSceneId = 'api-call' | 'sampling' | 'context' | 'tools' | 'agent';

/** Preserve only the known local learning destinations and their supported state. */
export function theaterReturnPath(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return '/explore';
  try {
    const url = new URL(raw, 'https://spark-lab.invalid');
    if (url.origin !== 'https://spark-lab.invalid') return '/explore';
    if (url.pathname === '/') return '/';
    const query = new URLSearchParams();
    if (/^\/lab\/(first-call|context|tools|agent-loop)$/.test(url.pathname)) {
      const replay = url.searchParams.get('replay');
      if (replay && /^[a-zA-Z0-9_-]{1,128}$/.test(replay)) query.set('replay', replay);
      if (url.searchParams.get('entry') === 'story') query.set('entry', 'story');
    } else if (url.pathname === '/explore') {
      const at = url.searchParams.get('at');
      if (at && /^(first-call|context|tools|agent-loop|tokens|embeddings|rag|memory|evaluation|capstone|transformer|training|mcp|multi-agent)$/.test(at)) query.set('at', at);
    } else return '/explore';
    return url.pathname + (query.size ? `?${query}` : '');
  } catch { return '/explore'; }
}
export type TheaterFrame = {
  title: string;
  narration: string;
  phase: 'input' | 'distribution' | 'draw' | 'answer' | 'assemble' | 'model' | 'request' | 'validate' | 'calculate' | 'tool' | 'observe' | 'stop';
  round?: number;
  memory?: string[];
  payload?: string;
};

export const theaterScenes: { id: TheaterSceneId; title: string; question: string; lesson: string; note: string }[] = [
  { id: 'api-call', title: 'LLM 调用', question: '隐藏页面上的回答，模型调用也会消失吗？', lesson: 'first-call', note: '调用协议教学示例 · 没有发起真实 API 请求' },
  { id: 'context', title: '上下文', question: '它记得你喜欢做饭，还是这次又读到了？', lesson: 'context', note: '教学模型 · 回答按示例规则变化，没有调用真实 API' },
  { id: 'tools', title: '工具调用', question: '拿到 calculator 请求，就已经有计算结果了吗？', lesson: 'tools', note: '工具请求为教学示例 · 参数校验与乘法在页面实际计算' },
  { id: 'agent', title: 'Agent 循环', question: '资料和计算结果都有了，为什么还没有最终回答？', lesson: 'agent-loop', note: '固定教学路径 · search 使用内置资料，不是互联网搜索' },
  { id: 'sampling', title: 'Token 采样', question: '随机落点不变，改变温度为什么可能换一个候选？', lesson: 'tokens', note: '固定示例分数 · 概率实际计算，不代表真实模型的概率' },
];

export const comparisonGuides: Record<TheaterSceneId, { task: string; unchanged: string; why: string }> = {
  'api-call': { task: '只切换 B 的“显示回答”，对照请求、响应和页面输出。', unchanged: '两组使用同一个问题和同一份示例响应。', why: 'lab.model 负责取得响应，lab.output 负责展示响应。隐藏显示不会撤回已经发生的调用。' },
  context: { task: '只开关 B 的“喜欢做饭”背景，找出消息和回答的变化。', unchanged: '两组的问题、规则和教学模型保持一致。', why: '背景必须进入本次请求才可被利用。示例模型按照输入中的背景选择解释方式，而不是读取上次运行。' },
  tools: { task: '只切换 B 是否执行工具；再清空一个数字，观察错误停在哪里。', unchanged: 'A、B 始终收到同一份工具请求；数字修改会同时作用于两组。', why: '工具请求是一份名称与参数。只有程序接受、校验并执行它，才会得到工具结果。' },
  agent: { task: '只把 B 的调用上限从 3 改为 2，检查已经拿到和仍然缺少的内容。', unchanged: '任务、工具和结果回传规则相同；只改变允许调用模型的轮数。', why: '工具返回只是中间证据。这条教学路径需要第 3 轮生成总结，轮数耗尽只代表停止，不代表完成。' },
  sampling: { task: '只调 B 的温度；保持随机落点 u = 0.80，比较概率和选中区间。', unchanged: '上下文、四个候选分数和随机落点完全相同。', why: '温度改变概率区间的长度。固定落点可能落入另一段，也可能仍留在原区间；概率变化不保证这一次选择必然改变。' },
};

export function apiCallFrames(): TheaterFrame[] {
  return [
    { phase: 'input', title: '准备 messages', narration: 'A、B 把完全相同的问题放进 messages。显示开关没有修改这份请求输入。' },
    { phase: 'request', title: '发送请求', narration: '应用把模型标识和消息组成请求体，发给模型服务。这里展示一种兼容接口格式，不真正联网。' },
    { phase: 'model', title: '等待模型服务', narration: 'await 等待响应返回。等待状态只表示请求尚未结束，不代表能够看到服务内部怎样计算。' },
    { phase: 'answer', title: '解析响应', narration: 'lab.model 把服务响应整理成统一的 text 与 toolCalls。两组拿到同一份 response；B 关闭显示只影响页面输出，不会删除这些返回值。' },
  ];
}

export function apiCallPayload(prompt: string) {
  const messages = [{ role: 'user', content: prompt }];
  const text = !prompt.trim() ? '教学示例：当前消息为空。' : /agent|智能体/i.test(prompt)
    ? '教学示例：Agent 让模型选择工具，接收结果，再根据停止条件继续或结束。'
    : /大语言模型|llm/i.test(prompt) ? '教学示例：大语言模型根据输入上下文生成后续文字，重要信息仍需要核对。'
      : `教学示例：针对「${prompt}」的回答会出现在这里。`;
  return {
    request: { model: 'teaching-model', messages },
    response: { text, toolCalls: [] },
  };
}

export function apiOutputCase(prompt: string, showOutput: boolean) {
  const payload = apiCallPayload(prompt);
  return { ...payload, showOutput, displayedText: showOutput ? payload.response.text : null, source: 'teaching-example' as const };
}

export function toolExecutionCase(left: string, right: string, execute: boolean) {
  const request = { name: 'calculator', arguments: { expression: `${left} * ${right}` } };
  if (!execute) return { request, status: 'request-only' as const, result: null, reason: '没有调用 lab.tool，因此没有工具结果。' };
  const checked = validateOperands(left, right);
  return checked.valid
    ? { request, status: 'executed' as const, result: checked.value, reason: '参数通过校验，计算器执行乘法并返回结果。' }
    : { request, status: 'rejected' as const, result: null, reason: checked.reason };
}

export function agentOutcome(maxRounds: number) {
  const frames = agentFrames(maxRounds);
  const end = frames[frames.length - 1];
  const memory = end.memory ?? [];
  return { calls: end.round ?? 0, evidence: memory, hasSearch: memory.includes('RAG 资料'), hasCalculation: memory.includes('计算结果 391'), hasSummary: end.phase === 'answer', stopReason: end.phase === 'answer' ? '返回最终回答' : '调用轮数到达上限', summary: end.phase === 'answer' ? end.payload ?? '' : null };
}

export function samplingCase(temperature: number, draw = 0.8) {
  const probabilities = samplingDistribution(temperature);
  const chosen = chooseCandidate(probabilities, draw);
  const start = probabilities.slice(0, chosen).reduce((total, value) => total + value, 0);
  return { temperature, draw, probabilities, chosen, word: samplingCandidates[chosen].text, start, end: start + probabilities[chosen] };
}

export const samplingCandidates = [
  { text: '睡觉', score: 2.8 },
  { text: '晒太阳', score: 2.0 },
  { text: '看书', score: 1.1 },
  { text: '起飞', score: 0.2 },
];

/** A numerically stable softmax over the explicitly supplied teaching logits. */
export function samplingDistribution(temperature: number): number[] {
  const t = Math.max(0.2, Math.min(2, temperature));
  const maxScore = Math.max(...samplingCandidates.map(item => item.score));
  const weights = samplingCandidates.map(item => Math.exp((item.score - maxScore) / t));
  const total = weights.reduce((sum, item) => sum + item, 0);
  return weights.map(item => item / total);
}

export function chooseCandidate(probabilities: number[], draw: number): number {
  let boundary = 0;
  for (let index = 0; index < probabilities.length; index++) {
    boundary += probabilities[index];
    if (draw < boundary) return index;
  }
  return probabilities.length - 1;
}

export function validateOperands(left: string, right: string): { valid: boolean; reason: string; value: number | null } {
  if (!left.trim() || !right.trim()) return { valid: false, reason: '缺少数字：请把两个参数都填完整。', value: null };
  const values = [Number(left), Number(right)];
  if (!values.every(value => Number.isSafeInteger(value) && Math.abs(value) <= 9999)) {
    return { valid: false, reason: '本工具只接受 −9999 到 9999 的整数。', value: null };
  }
  return { valid: true, reason: 'calculator 允许使用；算式中的两个数都是范围内的整数。', value: values[0] * values[1] };
}

export function samplingFrames(): TheaterFrame[] {
  return [
    { phase: 'input', title: '给定同一个开头', narration: '先固定上下文。这里用四个候选片段，缩小一个真实词表会包含的选择空间。' },
    { phase: 'distribution', title: '温度改变概率分布', narration: '先将示例分数除以温度，再归一化为概率。温度越低，最高分候选通常越占优势。' },
    { phase: 'draw', title: '一个随机数，落进一段区间', narration: '把概率接成 0 到 1 的区间。随机落点在哪一段，就选中那一段的候选。' },
    { phase: 'answer', title: '选中的片段接到后面', narration: '这轮采样完成。真实自回归生成会把新 Token 放回上下文，再计算下一轮分布。' },
  ];
}

export function contextFrames(withBackground: boolean): TheaterFrame[] {
  return [
    { phase: 'input', title: '先摆出手里的消息', narration: '你可以保留或拿走“我喜欢做饭”这条背景。当前问题始终不变。' },
    { phase: 'assemble', title: '组装这一次请求', narration: withBackground ? '规则、背景和当前问题一起装入上下文；背景不会靠模型自动想起。' : '这次只装入规则和当前问题，关于做饭的背景没有被发送。' },
    { phase: 'model', title: '模型只读本次携带的信息', narration: '画面表示应用传给模型的消息，不表示模型内部的注意力或思维过程。' },
    { phase: 'answer', title: '相同问题，不同背景', narration: withBackground ? '教学模型按规则给出厨房比喻；真实 API 可能有不同措辞，仍需检查实际输入。' : '教学模型改用一般解释。真实模型偶然提到做饭，也不能证明它记住了此前运行。' },
  ];
}

export function contextPayload(withBackground: boolean) {
  const messages = [
    { kind: 'system', role: 'system', content: '用熟悉的例子，简单解释。' },
    ...(withBackground ? [{ kind: 'history', role: 'user', content: '我喜欢做饭。' }] : []),
    { kind: 'question', role: 'user', content: '大语言模型是什么？' },
  ];
  return {
    messages,
    answer: withBackground
      ? '就像读过很多菜谱的厨房助手，它会根据你说的内容接着组织文字；但也可能把配料记错。'
      : '大语言模型根据已有上下文生成后续文字。回答可能出错，重要信息还需要核对。',
  };
}

export function toolFrames(valid: boolean, execute = true): TheaterFrame[] {
  const frames: TheaterFrame[] = [
    { phase: 'input', title: '两组面对同一个计算任务', narration: 'A、B 使用相同的两个数字。对照只改变 B 的程序是否执行工具；修改数字时，两组参数会一起变化。' },
    { phase: 'request', title: '模型提出工具请求', narration: '模型给出工具名称和参数。到这里，计算器还没有执行。' },
    { phase: 'validate', title: valid ? '程序先验证请求' : '参数不合法，不能继续', narration: !execute ? 'B 尚未接受执行请求。打开执行开关后，程序仍须先校验工具名称与参数，不能盲目执行模型返回的内容。' : valid ? '程序确认 calculator 在允许列表内，且两个参数都是范围内的整数，才允许下一步。' : '校验失败就不执行工具。补全数字，或使用范围内的整数后，可以重新播放。' },
  ];
  if (valid) frames.push(
    { phase: 'calculate', title: execute ? '计算器真正执行乘法' : '执行开关关闭，还没有计算', narration: execute ? '页面里的计算程序使用刚刚校验过的数字相乘；这是工具结果，不是模型猜出的数字。' : 'B 目前没有执行计算器，所以结果仍为空。工具请求只描述要做什么；打开执行开关才能得到乘法结果。' },
    { phase: 'answer', title: execute ? '把结果交回应用' : '没有执行，就没有工具结果', narration: execute ? '应用可以直接展示工具结果，也可以把结果放进下一次模型请求，继续完成任务。' : 'A、B 当前都没有工具结果。程序不能把一份工具请求当作执行成功的证明。' },
  );
  return frames;
}

export function agentFrames(maxRounds: number): TheaterFrame[] {
  const limit = Math.max(1, Math.min(5, Math.floor(maxRounds)));
  const frames: TheaterFrame[] = [
    { phase: 'input', title: '一个任务，三个目标', narration: '查到 RAG 的解释，算出 17 × 23，再把结果总结出来。轮数限制的是模型调用次数。', round: 0, memory: [], payload: '查资料 → 做计算 → 总结' },
  ];
  const memory: string[] = [];
  for (let round = 1; round <= Math.min(limit, 2); round++) {
    const search = round === 1;
    frames.push(
      { phase: 'model', title: `第 ${round} 轮：请求模型决定下一步`, narration: search ? '教学规则先提出 search 请求。此时还没有检索结果。' : '已有检索结果进入本次上下文，教学规则接着提出 calculator 请求。', round, memory: [...memory], payload: search ? 'search({ query: "RAG" })' : 'calculator({ expression: "17 * 23" })' },
      { phase: 'tool', title: search ? '执行资料检索' : '执行计算工具', narration: search ? 'search 从内置教学资料中返回 RAG 解释，不是互联网搜索。' : '计算器执行 17 × 23，得到 391；工具不会自动替应用保存状态。', round, memory: [...memory], payload: search ? 'RAG：先检索资料，再用资料辅助生成。' : '17 × 23 = 391' },
    );
    memory.push(search ? 'RAG 资料' : '计算结果 391');
    frames.push({ phase: 'observe', title: '观察结果，更新上下文', narration: '应用把刚刚的工具结果写入 history。下一轮模型请求带着这些结果继续。', round, memory: [...memory], payload: `history：${memory.join(' ＋ ')}` });
  }
  if (limit < 3) {
    frames.push({ phase: 'stop', title: `达到 ${limit} 轮上限，任务尚未完成`, narration: '预算条件让程序停止，即使已经获得工具结果，也不能把尚未生成总结的状态当成完成。', round: limit, memory: [...memory], payload: '停止原因：maxSteps · 尚未生成最终总结' });
  } else {
    frames.push(
      { phase: 'model', title: '第 3 轮：用已有结果组织回答', narration: '这次上下文已经包含两份工具结果。教学模型返回回答，不再提出新的工具请求。', round: 3, memory: [...memory], payload: 'toolCalls: [] → 返回最终回答' },
      { phase: 'answer', title: '结束循环，不必用完所有轮数', narration: `实际用了 3 轮，允许最多 ${limit} 轮。停止条件已满足；真实任务还需要检查答案是否正确。`, round: 3, memory: [...memory], payload: 'RAG 用检索到的资料辅助回答。17 × 23 的结果是 391。' },
    );
  }
  return frames;
}
