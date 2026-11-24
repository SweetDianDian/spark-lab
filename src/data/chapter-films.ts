/** Explicit teaching fixtures. These films never call a model or claim to expose its internals. */
export type FilmNode = { id: string; label: string; x: number; y: number };
export type FilmLink = { from: string; to: string; bend?: number };
export type FilmTransfer = { from: string; to: string; label: string };
export type FilmVisual =
  | { kind: 'tokens'; tokens: string[]; probabilities: number[]; temperature: number; picked?: number; threshold?: number }
  | { kind: 'vectors'; query: number[]; scores: number[]; ranked: boolean }
  | { kind: 'attention'; phase: 'scores' | 'weights' | 'sum'; weights: number[]; queryStrength: number }
  | { kind: 'training'; weight: number; predictions: number[]; loss: number; learningRate: number; updated: boolean }
  | { kind: 'evaluation'; results: ('pending' | 'pass' | 'fail')[]; actual: number[]; variant: string };
export type ChapterFilmFrame = {
  id: string;
  title: string;
  action: string;
  cause: string;
  active: string[];
  values: Record<string, string>;
  transfers?: FilmTransfer[];
  evidence: { label: string; value: string }[];
  visual?: FilmVisual;
};
export type ChapterFilmDefinition = {
  lessonId: string;
  version: number;
  title: string;
  question: string;
  goal: string;
  note: string;
  nodes: FilmNode[];
  links: FilmLink[];
  frames: ChapterFilmFrame[];
};

export function softmaxForFilm(logits: readonly number[], temperature = 1): number[] {
  if (!Number.isFinite(temperature) || temperature <= 0 || !logits.length || logits.some(value => !Number.isFinite(value))) throw new Error('Expected finite logits and positive temperature');
  const max = Math.max(...logits);
  const values = logits.map(value => Math.exp((value - max) / temperature));
  const sum = values.reduce((a, b) => a + b, 0);
  return values.map(value => value / sum);
}

export function pickFilmToken(probabilities: readonly number[], point: number): number {
  if (point < 0 || point >= 1 || !Number.isFinite(point) || probabilities.some(value => !Number.isFinite(value) || value < 0) || Math.abs(probabilities.reduce((a, b) => a + b, 0) - 1) > 1e-6) throw new Error('Expected normalized probabilities and a point in [0, 1)');
  let cumulative = 0;
  return probabilities.findIndex(value => { cumulative += value; return point < cumulative; });
}

export function clampFilmFrame(index: number | undefined, length: number): number {
  return Math.max(0, Math.min(Math.max(0, length - 1), Number.isFinite(index) ? Math.floor(index!) : 0));
}

const line = (...labels: string[]): FilmNode[] => labels.map((label, index) => ({ id: `n${index}`, label, x: labels.length === 1 ? 450 : 110 + index * 680 / (labels.length - 1), y: 145 }));
const chain = (nodes: FilmNode[]): FilmLink[] => nodes.slice(1).map((node, index) => ({ from: nodes[index].id, to: node.id }));
const move = (from: string, to: string, label: string): FilmTransfer[] => [{ from, to, label }];
const proof = (label: string, value: string) => [{ label, value }];
const frame = (id: string, action: string, cause: string, active: string[], values: Record<string, string>, transfers: FilmTransfer[] = [], evidence: ChapterFilmFrame['evidence'] = [], visual?: FilmVisual): ChapterFilmFrame => ({ id, title: action.replace(/[。！]$/, ''), action, cause, active, values, transfers, evidence, visual });

const teaching: Record<string, { question: string; goal: string; steps: string[] }> = {
  'first-call': { question: '把问题从“大语言模型”换成“Agent”，回答会跟着变吗？', goal: '只改 question，核对实际输入和回答一起变化。', steps: ['写下问题','发起调用','查看返回','显示文字','省略输出','换个问题'] },
  context: { question: '怎么让助手用我熟悉的做饭经验来解释？', goal: '只清空 history，指出请求少了哪段背景，再对照解释的变化。', steps: ['准备背景','一起发送','清空历史','对照回答'] },
  tools: { question: '17 人每人 23 元，这笔钱到底是谁算的？', goal: '分清模型提出请求和程序执行计算，追到实际结果 391。', steps: ['提出请求','检查参数','执行乘法','接住结果','换成 19 人'] },
  'agent-loop': { question: '先查资料再算数，助手怎么知道下一步做什么？', goal: '把工具结果带回下一轮；分清“回答完成”和“达到轮数上限”。', steps: ['先查资料','带回结果','再做计算','生成总结','两轮就停'] },
  tokens: { question: '文字怎样切成片段，下一片又怎么选？', goal: '看见词表切分；固定落点 0.8，只改温度，比较选中的候选。', steps: ['切成片段','算出概率','落点选词','改变温度'] },
  embeddings: { question: '资料有好几条，怎么先找到与问题相关的一条？', goal: '用四个词频表示文本；改查询后，核对向量和排名为什么改变。', steps: ['表示查询','表示资料','比较方向','换个查询'] },
  rag: { question: '怎么从资料里摘出有出处的一段话？', goal: '让检索片段、来源编号和最后摘录保持一致，不凭空添加引用。', steps: ['给资料编号','找相关片段','保留出处','换个问题'] },
  memory: { question: '任务中断后，怎么避免同一笔账记两次？', goal: '对照保留与丢失完成标记，解释同一账本为何得到 46 或 69。', steps: ['先记一笔','保存快照','跳过旧操作','丢掉标记'] },
  evaluation: { question: '程序能运行，为什么小数那一例还是算错了？', goal: '按同一组案例和容差评分，验证取消取整后从 2/3 变成 3/3。', steps: ['定好考题','实际计算','逐项评分','修正取整'] },
  capstone: { question: '17 人和 19 人的聚餐，都在 420 元预算内吗？', goal: '同时检查资料来源、算术和预算，超预算时让报告明确不通过。', steps: ['查到菜单','计算费用','核验预算','增加人数'] },
  transformer: { question: '同样两份信息，怎样决定各取多少？', goal: '用小矩阵算混合比例；把查询反向，核对两份值的贡献如何交换。', steps: ['算匹配分','变成比例','混合信息','反转查询'] },
  training: { question: '明明在纠正误差，为什么更新后反而更差？', goal: '对照学习率 0.1 与 0.8，解释参数移动和损失下降或上升。', steps: ['先看误差','求变化方向','小步更新','步子太大'] },
  mcp: { question: '工具出现在清单里，就一定能调用吗？', goal: '区分发现工具与执行工具；关闭允许调用后，检查执行次数仍为 0。', steps: ['询问能力','按格式请求','获准后执行','拒绝调用'] },
  'multi-agent': { question: '金额没错，为什么交给下一角色仍被退回？', goal: '检查交接里有没有有效来源，理解下一角色只能判断收到的数据。', steps: ['分清任务','交接数据','核验接收','拿走来源'] },
};

const film = (lessonId: string, title: string, question: string, nodes: FilmNode[], frames: ChapterFilmFrame[], note: string, links = chain(nodes), version = 1): ChapterFilmDefinition => {
  const lesson = teaching[lessonId];
  return { lessonId, version, title, question: lesson?.question ?? question, goal: lesson?.goal ?? question, nodes, links,
    frames: frames.map((item, index) => ({ ...item, title: lesson?.steps[index] ?? item.title })), note };
};

export const FIRST_CALL_EXAMPLE = {
  question: '用一句话解释什么是大语言模型。',
  answer: '大语言模型像一个读过很多文字的接话助手，会根据你提供的内容继续生成文字，但答案可能出错。',
  changedQuestion: '用一句话解释什么是 Agent。',
  changedAnswer: 'Agent 会让模型选择工具、查看结果，直到任务完成或达到限制。',
};
const probabilities1 = softmaxForFilm([2, 1, 0], .7);
const probabilities2 = softmaxForFilm([2, 1, 0], .2);
const attentionWeights = softmaxForFilm([1 / Math.sqrt(2), -1 / Math.sqrt(2)]);

export const CHAPTER_FILMS: readonly ChapterFilmDefinition[] = [
  film('first-call', '让程序接住并显示第一句回答', '', line('question 问题', 'lab.model 调用', 'response 对象', 'lab.output 显示'), [
    frame('input', '把要问的话存进 question，再记录这次输入。', 'question 是保存文字的变量。lab.step 只留下“这次问了什么”的记录；此时还没有调用模型。', ['n0'], { n0: FIRST_CALL_EXAMPLE.question, n1: '尚未调用', n2: '尚无返回值', n3: '尚无输出' }, [], proof('代码里的原问题', `question = '${FIRST_CALL_EXAMPLE.question}'`)),
    frame('request', '把 question 交给 prompt，并等待调用结束。', 'prompt 是接口接收问题的字段。await 表示后面的代码先等返回值；lab.model 是本实验提供的调用接口。', ['n0','n1'], { n0: '这次的问题文字', n1: 'prompt = question', n2: 'await 正在等待', n3: '还没执行到这里' }, move('n0','n1','问题文字'), proof('本次传入的参数值', `prompt: '${FIRST_CALL_EXAMPLE.question}'`)),
    frame('response', '接到 response，用 lab.log 查看它的字段。', 'response 是一个对象，不是那句回答本身。text 装着回答文字；toolCalls 是工具请求列表，本次为空。日志只是帮助查看。', ['n1','n2'], { n0: '原问题不变', n1: '本次调用结束', n2: 'text: 回答文字；toolCalls: []', n3: '还没显示文字' }, move('n1','n2','response 对象'), proof('教学模式实际返回的字段', `text = “${FIRST_CALL_EXAMPLE.answer}”\ntoolCalls = []`)),
    frame('display', '取出 response.text，交给 lab.output 显示。', '点号表示“读取对象里的这个字段”。页面需要的是 text 里的文字，所以不能把 response 对象和回答文字混为一谈。', ['n2','n3'], { n0: '问题已发送', n1: '调用已结束', n2: '读取 text 字段', n3: '显示这段回答文字' }, move('n2','n3','response.text'), proof('这次显示的内容', FIRST_CALL_EXAMPLE.answer)),
    frame('hide-output', '做个对照：只省略最后的 lab.output。', '前面的调用和日志仍会执行，response.text 仍然存在；只是这次没有输出记录。看不到结果不能直接断定模型没被调用。', ['n2','n3'], { n0: '问题仍发送', n1: '调用仍完成', n2: '日志里仍能看到 text', n3: '没有 lab.output 事件' }, [], proof('只做这个反事实对照', '省略 lab.output(response.text)；保留 await lab.model(...) 和 lab.log(response)。')),
    frame('change-question', '恢复输出，只把 question 换成问 Agent。', '用同一段调用代码再运行：先核对输入记录包含 Agent，再核对返回和输出也改成 Agent。这样才知道改动确实传了过去。', ['n0','n1','n2','n3'], { n0: FIRST_CALL_EXAMPLE.changedQuestion, n1: 'prompt 接到新问题', n2: 'text 换成 Agent 的解释', n3: '显示新的回答' }, [...move('n0','n1','新问题'),...move('n2','n3','新 text')], [{label:'只改这一处',value:`question = '${FIRST_CALL_EXAMPLE.changedQuestion}'`},{label:'教学模式的新回答',value:FIRST_CALL_EXAMPLE.changedAnswer}]),
  ], '动图不发起调用。代码的教学模式使用可复现规则；真实 API 模式才连接配置的模型，具体回答可能不同。'),

  film('context', '背景必须随这次请求一起走', '为什么“我喜欢做饭”能改变解释方式？', line('历史消息', '本次输入', '模型', '解释'), [
    frame('history', '先准备两条历史消息，其中一条说喜欢做饭。', 'history 保存要重新交给模型的旧消息；这个实验没有隐藏记忆，程序不发送，模型就看不到这段背景。', ['n0'], { n0: 'history 有 2 条消息', n1: '那大语言模型是什么？', n2: '尚未收到', n3: '尚未回答' }, [], proof('history[0]', '我完全没学过 AI，但是我喜欢做饭。')),
    frame('include', '把历史与问题一起发送。', '模型可见的输入多了一条做饭背景，示例解释因此选择菜谱比喻。', ['n1', 'n2', 'n3'], { n0: '包含在 history', n1: '背景 + 当前问题', n2: '看到做饭背景', n3: '像读过很多菜谱…' }, [...move('n0', 'n1', 'history'), ...move('n1', 'n2', 'messages')], proof('示例回答 A', '像读过很多菜谱后学会搭配食材，它从文本里学习表达规律。')),
    frame('remove', '只把 history 清空，两条旧消息都不再发送。', '保留回答风格 system 和当前问题 question；变化只有历史消息从 2 条变成 0 条，做饭背景随之消失。', ['n0', 'n1'], { n0: 'history: []', n1: 'system 和 question 不变', n2: '没有做饭背景', n3: '等待新的示例' }, move('n1', 'n2', '当前问题'), proof('只改这一处', 'const history = []; // Python 对应 history = []')),
    frame('compare', '先核对历史从 2 条变成 0 条，再看回答。', '教学规则不再使用做饭比喻。真实模型也可能碰巧使用这种比喻，因此判断背景是否发送，要看输入记录。', ['n2', 'n3'], { n0: 'history: []', n1: 'system 和 question 保留', n2: '没有做饭背景', n3: '换成普通解释' }, move('n2', 'n3', '回答 B'), proof('教学模式清空 history 后的回答', FIRST_CALL_EXAMPLE.answer)),
  ], 'A/B 回答是明确编写的教学样本；不保证真实模型必然使用某种比喻。'),

  film('tools', '391 到底是谁算出来的？', '模型说“调用计算器”，计算就完成了吗？', line('模型请求', '参数校验', '计算器', '返回结果'), [
    frame('intent', '模型先提出工具请求。', '这里只得到工具名和参数，还没有运行乘法。toolCalls[0].name 是名称，arguments 才是交给工具的参数。', ['n0'], { n0: 'calculator(17 × 23)', n1: '未校验', n2: '未执行', n3: '没有结果' }, [], proof('工具请求的实际字段', 'name: calculator · arguments: { expression: "17 * 23" }')),
    frame('validate', '程序检查工具名与算式。', '只有允许的工具和有效参数可以交给执行器；错误参数应在这里停止。', ['n0', 'n1'], { n0: 'calculator', n1: '数字与乘号：通过', n2: '等待执行', n3: '没有结果' }, move('n0', 'n1', '17 * 23'), proof('校验边界', '工具是否允许 + expression 是否为合法算式。')),
    frame('execute', '计算器执行乘法。', '数值 391 来自程序计算，不能把工具请求本身当作计算证据。', ['n1', 'n2'], { n0: '请求已接住', n1: '通过', n2: '17 × 23 = 391', n3: '等待返回' }, move('n1', 'n2', '有效参数'), proof('计算结果', '17 × 23 = 391')),
    frame('return', '把实际数值写回结果。', '显示或下一轮模型读取的是工具返回的数，证据链才闭合。', ['n2', 'n3'], { n0: '请求完成', n1: '通过', n2: 'result: 391', n3: '本桌总额 391 元' }, move('n2', 'n3', '391'), proof('证据对应', '17 人 × 每人 23 元 → 工具数值 391 → 账单 391 元。')),
    frame('change-number', '把人数从 17 改为 19。', '参数应一路变成 19 × 23，结果随之变成 437；不能沿用旧账单。', ['n0', 'n2', 'n3'], { n0: 'calculator(19 × 23)', n1: '重新校验', n2: '19 × 23 = 437', n3: '新账单 437 元' }, move('n2', 'n3', '437'), proof('仅改一个输入', '人数 17 → 19；单价仍为 23。')),
  ], '算式与结果为可核对的教学数据；此动图本身不执行工具。'),

  film('agent-loop', '把结果带回去，才有下一步', '为什么工具跑完以后，还需要再问模型？', [
    { id: 'n0', label: '模型决策', x: 160, y: 90 }, { id: 'n1', label: '执行工具', x: 470, y: 90 }, { id: 'n2', label: '追加历史', x: 470, y: 235 }, { id: 'n3', label: '停止条件', x: 760, y: 235 },
  ], [
    frame('search', '第 1 轮先请求查询 RAG。', '任务缺少事实依据，因此先取资料；还不能直接给出完整总结。', ['n0', 'n1'], { n0: '轮次 1 / 3', n1: 'search("RAG")', n2: '还没有工具结果', n3: '继续' }, move('n0', 'n1', '查询请求'), proof('本轮结果', 'RAG：检索增强生成。')),
    frame('feedback', '把查询结果追加到历史。', '下一轮只有收到这条结果，才能基于已有证据决定接下来做什么。', ['n1', 'n2'], { n0: '准备第 2 轮', n1: 'RAG = 检索增强生成', n2: '保存 search 结果', n3: '继续' }, move('n1', 'n2', '资料'), proof('下一轮输入增加', '工具返回 search: RAG 是检索增强生成。')),
    frame('calculate', '第 2 轮再请求计算。', '查询已经完成，这轮补上另一项缺少的数值证据。', ['n0', 'n1', 'n2'], { n0: '轮次 2 / 3', n1: 'calculator(17 × 23)', n2: 'search + result:391', n3: '还缺最终总结' }, [...move('n2', 'n0', '已有资料'), ...move('n0', 'n1', '计算请求')], proof('已有证据', 'RAG 的解释 + 17 × 23 = 391。')),
    frame('finish', '第 3 轮用两项证据总结。', '模型返回最终文字而不是新的工具请求，这次循环正常结束。', ['n0', 'n3'], { n0: '轮次 3 / 3', n1: '不再请求工具', n2: '两项结果已提供', n3: '最终回答 → 结束' }, move('n0', 'n3', '最终文字'), proof('正常停机原因', '本轮 toolCalls 为空，已得到最终回答。')),
    frame('limit', '把 maxSteps 只改为 2。', '证据可以已经齐全，但第 3 轮没有发生，因此不能声称已经生成最终总结。', ['n3'], { n0: '轮次 2 / 2', n1: '工具可能都完成', n2: '资料和 391 已有', n3: '达到上限，缺总结' }, [], proof('上限停机原因', 'maxSteps = 2；循环退出不等于任务成功。')),
  ], '有限状态循环的教学示意；模型决策是预设样本。', [{ from: 'n0', to: 'n1' }, { from: 'n1', to: 'n2' }, { from: 'n2', to: 'n0', bend: -55 }, { from: 'n0', to: 'n3', bend: -250 }]),

  film('tokens', '温度改变概率，落点保持不动', '同一个 draw = 0.8，为什么会选中另一个候选？', [], [
    frame('pieces', '按小词表最长匹配切开文字。', 'AI学习AI 被切成 AI / 学习 / AI；这套手写词表只用来说明分词。', [], {}, [], proof('代码对应 tokenize', 'vocabulary=[AI,学习,学,习] → pieces=[AI,学习,AI]，ids=[1,2,1]。'), { kind: 'tokens', tokens: ['继续', '结束', '换个词'], probabilities: [0, 0, 0], temperature: .7 }),
    frame('softmax', '用温度 0.7 归一化固定分数。', '分数 [2,1,0] 变成约 77.1%、18.5%、4.4%，这些概率的总和为 1。', [], {}, [], proof('代码对应 sample', 'probabilities = softmax(logits / temperature)'), { kind: 'tokens', tokens: ['继续', '结束', '换个词'], probabilities: probabilities1, temperature: .7 }),
    frame('sample-one', '把 draw = 0.8 放入累计区间。', '第一个区间只到约 0.771，0.8 落在第二个区间，所以选中“结束”。', [], {}, [], proof('selected', '结束；draw 固定为 0.8。'), { kind: 'tokens', tokens: ['继续', '结束', '换个词'], probabilities: probabilities1, temperature: .7, threshold: .8, picked: pickFilmToken(probabilities1, .8) }),
    frame('temperature', '只把 temperature 改为 0.2。', '分布变尖，第一个区间约为 0.993；相同的 0.8 现在落在“继续”里。', [], {}, [], proof('动手只改这里', 'temperature: 0.7 → 0.2；保持 draw = 0.8，比较 selected。'), { kind: 'tokens', tokens: ['继续', '结束', '换个词'], probabilities: probabilities2, temperature: .2, threshold: .8, picked: pickFilmToken(probabilities2, .8) }),
  ], '教学例子与本章代码同值：手写小词表、固定 logits；不是线上模型的分词或概率。'),

  film('embeddings', '每一维先有明确含义，再比较相似度', '查询换成“计算 工具”，第一名为什么会改变？', [], [
    frame('query', '把查询的四个词频写成向量。', '维度按“模型、检索、计算、工具”排列；模型 检索 对应 [1,1,0,0]。', [], {}, [], proof('代码对应 embed', 'queryVector=[1,1,0,0]；这是可检查的词项特征。'), { kind: 'vectors', query: [1,1,0,0], scores: [0,0,0], ranked: false }),
    frame('documents', '用同一词表表示三条资料。', 'rag 有一次模型、两次检索；calculator 有一次计算、两次工具；所有向量维度一致。', [], {}, [], proof('资料向量', 'rag=[1,2,0,0]；calculator=[0,0,1,2]；mixed=[1,0,0,1]。'), { kind: 'vectors', query: [1,1,0,0], scores: [0,0,0], ranked: false }),
    frame('similarity', '用余弦归一化后排序。', 'rag 得分约 0.949，mixed 为 0.5，calculator 为 0；字数多不直接等于相似。', [], {}, [], proof('代码对应 rank', 'cos(q,d)=(q·d)/(‖q‖‖d‖)；bestMatch=rag。'), { kind: 'vectors', query: [1,1,0,0], scores: [3/Math.sqrt(10),0,.5], ranked: true }),
    frame('change-query', '只把 query 改为“计算 工具”。', '查询向量变为 [0,0,1,1]，calculator 升到第一；词表外的同义词不会自动被理解。', [], {}, [], proof('动手只改这里', 'query: 模型 检索 → 计算 工具；bestMatch: rag → calculator。'), { kind: 'vectors', query: [0,0,1,1], scores: [0,3/Math.sqrt(10),.5], ranked: true }),
  ], '教学例子与代码同值；这是词频向量，不是训练好的语义 embedding。'),

  film('rag', '先找回原文，再把来源带到输出', '检索问题变了，引用会不会还停在上一份资料？', line('本地资料', '词项检索', '上下文组装', '证据摘录'), [
    frame('documents', '先给三份本地资料标明编号。', 'd1 讲记忆，d2 讲工具，d3 讲评测；编号让输出可以回查原文。', ['n0'], { n0: 'd1记忆 · d2工具 · d3评测', n1: 'question:记忆', n2: 'topK=1', n3: '还未摘录' }, [], proof('资料 d1', '记忆需要由程序保存，恢复时还要检查已完成操作。')),
    frame('retrieve', '用“记忆”命中 d1。', '代码按词项命中计分，取最高的一条；没有运行生成模型。', ['n0','n1'], { n0: '三个固定片段', n1: 'retrieved:[d1]', n2: '等待组装', n3: '还未摘录' }, move('n0','n1','d1 原文'), proof('代码对应 retrieve', 'question=记忆；topK=1；retrieved[0].id=d1。')),
    frame('compose', '把 [d1] 与原文一起组装。', 'context 与 answer 都保留来源；这里输出的是证据摘录，不是模型生成的答案。', ['n1','n2','n3'], { n0: '原文不变', n1: 'd1', n2: '[d1] 记忆需要由程序保存…', n3: 'citations:[d1]' }, [...move('n1','n2','原文 + id'),...move('n2','n3','摘录')], proof('代码对应 compose', 'context / citations / answer 使用同一次检索结果。')),
    frame('change-query', '只把 question 改为“工具”。', '新问题命中 d2，引用也应跟着变；没有命中时必须输出资料不足。', ['n1','n2','n3'], { n0: 'd2:工具请求不是结果', n1: 'retrieved:[d2]', n2: '[d2] 工具请求不是执行结果…', n3: 'citations:[d2]' }, move('n2','n3','新引用 d2'), proof('动手只改这里', 'question: 记忆 → 工具；检查 retrieved、context、citations 同步改变。')),
  ], '教学例子与代码同源；本地词项检索和证据摘录，不联网，也没有生成模型。'),

  film('memory', '恢复余额时，完成标记也要一起回来', '只保存 23 元，为什么恢复后会变成 69？', line('第一次记账', 'JSON 快照', '恢复检查', '账本结果'), [
    frame('first-operation', '先构造一个“meal-a 已记账”的状态。', '代码直接用余额 23 和完成标记表示第一笔已经记好；下面要验证的是恢复后会不会重复记入。', ['n0'], { n0: 'balance:23', n1: '尚未保存', n2: 'meal-a / meal-b', n3: '待恢复' }, [], proof('firstState 的初值', 'balance:23；completedIds:[meal-a]。这一步没有真实付款。')),
    frame('checkpoint', '把余额和 completedIds 一起序列化。', 'JSON 快照能恢复明确字段，不会自动知道哪些操作已做过。', ['n0','n1'], { n0: 'meal-a 已完成', n1: '23 + [meal-a]', n2: 'JSON.parse(serialized)', n3: '准备继续' }, move('n0','n1','状态快照'), proof('代码对应 checkpoint', 'JSON.stringify(firstState) → serialized。')),
    frame('resume', '保留标记，跳过 meal-a。', '只执行 meal-b 再加 23，最终余额为 46；skippedIds 记录被跳过的第一项。', ['n1','n2','n3'], { n0: 'meal-a 已记23', n1: '保留完成标记', n2: '跳过a，执行b', n3: '23 + 23 = 46' }, [...move('n1','n2','完成标记'),...move('n2','n3','只新增23')], proof('resumed', 'balance:46；skippedIds:[meal-a]；executedIds:[meal-b]。')),
    frame('drop-marker', '只把 preserveCompletedIds 改为 false。', '余额 23 仍在，完成标记却没了；a 和 b 都执行，第一笔被重复计入，得到 69。', ['n2','n3'], { n0: '旧余额仍为23', n1: 'completedIds:[]', n2: 'a和b都执行', n3: '23 + 23 + 23 = 69' }, move('n2','n3','重复计入'), proof('动手只改这里', 'preserveCompletedIds: true → false；比较 46 与 69。')),
  ], '教学例子与代码同值；一次 worker 运行内模拟保存/恢复，不是实际付款或跨运行持久存储。'),

  film('evaluation', '同一份考卷，才能比较修改前后', '程序运行成功，是否就代表三个案例都答对？', [], [
    frame('cases', '固定三例输入和 0.01 的容差。', '17×23、1.25×2、0×9 的期望分别是 391、2.5、0；先确定规则再评分。', [], {}, [], proof('代码对应 input', 'tolerance=0.01；cases:integer / decimal / zero。'), { kind:'evaluation', results:['pending','pending','pending'], actual:[], variant:'固定测试集' }),
    frame('round', '先用会四舍五入的版本计算。', 'roundAnswers=true 把 2.5 变成 3，整数与零值没变；实际结果不能只看运行是否结束。', [], {}, [], proof('代码对应 execute', 'actual:[391,3,0]；expected:[391,2.5,0]。'), { kind:'evaluation', results:['pass','fail','pass'], actual:[391,3,0], variant:'roundAnswers = true' }),
    frame('score', '逐项比较误差，再统计成功率。', 'decimal 的绝对误差 0.5 大于 0.01，所以只有 2/3 通过。', [], {}, [], proof('代码对应 score', 'passed:2；total:3；failures:[decimal]。'), { kind:'evaluation', results:['pass','fail','pass'], actual:[391,3,0], variant:'2/3 通过' }),
    frame('fix', '只把 roundAnswers 改为 false。', '小数保留为 2.5，三例全部通过；这只证明这份小测试集，不代表总体能力。', [], {}, [], proof('动手只改这里', 'roundAnswers: true → false；successRate: 2/3 → 3/3。'), { kind:'evaluation', results:['pass','pass','pass'], actual:[391,2.5,0], variant:'roundAnswers = false' }),
  ], '教学例子与代码同值；评分对象是本地计算函数，不是真实模型评测。'),

  film('capstone', '把来源、计算与预算同时验收', '人数增加以后，报告会诚实地说超预算吗？', line('本地资料', '费用计算', '三项核验', '报告'), [
    frame('research', '按“聚餐”找到 menu-23。', '资料给每人 23 元；人数 17 与预算 420 来自任务输入，不能混成模型猜测。', ['n0'], { n0: 'menu-23:每人23元', n1: 'people:17', n2: 'budget:420', n3: '等待证据' }, [], proof('资料选择', 'documents 中另有交通 bus-8；topic=聚餐 只选 menu-23。')),
    frame('calculate', '用 17 × 23 算总额。', 'calculation.total 为 391，同时保留人数、单价与资料对象以便回查。', ['n0','n1'], { n0: '来源 menu-23', n1: '17 × 23 = 391', n2: '待检查', n3: '待核验' }, move('n0','n1','unitPrice:23'), proof('代码对应 research', 'calculation={people:17,unitPrice:23,total:391}。')),
    frame('approve', '分别检查来源、算术和预算。', '来源存在、算式一致、391≤420，三项都通过才令 approved=true。', ['n1','n2','n3'], { n0: '引用可回查', n1: 'total:391', n2: '三项均为true', n3: 'approved:true' }, [...move('n1','n2','391'),...move('n2','n3','通过')], proof('checks', 'sourceExists / arithmeticCorrect / withinBudget 都为 true。')),
    frame('over-budget', '只把 people 从 17 改为 19。', '总额变成 437，超出 420；来源和算术仍正确，但报告必须不通过。', ['n1','n2','n3'], { n0: 'menu-23保持不变', n1: '19 × 23 = 437', n2: '超出预算 17 元', n3: 'approved:false' }, move('n2','n3','超预算'), proof('动手只改这里', 'people:17 → 19；budget 保持 420；391 通过，437 不通过。')),
  ], '教学例子与代码同值；固定本地资料和确定性研究流程，不是实时餐厅报价或自主研究 Agent。'),

  film('transformer', '查询转向，两个值的混合比例也改变', 'Attention 输出里，到底混进了多少 V₁ 和 V₂？', [], [
    frame('scores', '用二维 Q 与两个 K 做缩放点积。', 'Q=[1,0]，K₁=[1,0]，K₂=[−1,0]；除以 √2 后分数约为 0.707、−0.707。', [], {}, [], proof('代码对应 attention', 'scores=(Q·K)/√2；queryStrength=1。'), {kind:'attention',phase:'scores',weights:attentionWeights,queryStrength:1}),
    frame('weights', '用 softmax 把分数变成权重。', '两个权重约 80.4% 与 19.6%，总和为 1；第一项混合得更多。', [], {}, [], proof('weights', '[0.8044,0.1956]；这是混合比例，不是模型的思维说明。'), {kind:'attention',phase:'weights',weights:attentionWeights,queryStrength:1}),
    frame('weighted-sum', '用权重混合 [10,0] 与 [0,20]。', '输出约为 [8.044,3.911]；V 的每一维分别乘权重后求和。', [], {}, [], proof('代码对应 mix', 'mixed=0.8044×[10,0]+0.1956×[0,20]。'), {kind:'attention',phase:'sum',weights:attentionWeights,queryStrength:1}),
    frame('flip-query', '只把 queryStrength 从 1 改成 −1。', '分数方向反转，权重交换；输出变为约 [1.956,16.089]，更多取自 V₂。', [], {}, [], proof('动手只改这里', 'queryStrength:1 → −1；比较 scores、weights 和 mixed。'), {kind:'attention',phase:'sum',weights:[...attentionWeights].reverse(),queryStrength:-1}),
  ], '教学例子与代码同值；二维单头计算，没有位置编码、因果 mask、多层网络或真实模型内部数据。'),

  film('training', '更新步子太大，损失反而会升高', '学习率变大，就能学得更好吗？', [], [
    frame('prediction', '用 w=0 预测两个训练样本。', 'x=[1,2]、目标=[2,4]，预测都为 0；平均平方误差 MSE 是 10。', [], {}, [], proof('代码对应 predict', 'lossBefore=((0−2)²+(0−4)²)/2=10。'), {kind:'training',weight:0,predictions:[0,0],loss:10,learningRate:.1,updated:false}),
    frame('gradient', '根据两个样本计算梯度 −10。', '梯度给出当前参数的局部变化方向；具体走多远还由学习率决定。', [], {}, [], proof('gradient', '2×[((0−2)×1)+((0−4)×2)]/2=−10。'), {kind:'training',weight:0,predictions:[0,0],loss:10,learningRate:.1,updated:false}),
    frame('update', '按 learningRate=0.1 更新一次。', 'w 从 0 变成 1，预测 [1,2]，MSE 从 10 降到 2.5。', [], {}, [], proof('代码对应 update', 'nextWeight=0−0.1×(−10)=1；lossAfter=2.5。'), {kind:'training',weight:1,predictions:[1,2],loss:2.5,learningRate:.1,updated:true}),
    frame('large-step', '只把 learningRate 改成 0.8。', '同一个梯度把 w 推到 8，跨过最优值 2；预测 [8,16]，MSE 升到 90。', [], {}, [], proof('动手只改这里', 'learningRate:0.1 → 0.8；lossBefore=10，lossAfter=90，improved=false。'), {kind:'training',weight:8,predictions:[8,16],loss:90,learningRate:.8,updated:true}),
  ], '教学例子与代码同值；一个参数、两个样本的 MSE，不是大语言模型训练或泛化证明。'),

  film('mcp', '发现能力，不等于已经执行或获准调用', 'allowCall=false 时，为什么工具列表仍然在？', line('本地客户端', 'localServer', 'meal_total', '响应对象'), [
    frame('discover', '先发 tools/list 查询工具契约。', '服务函数返回 meal_total 的名称和参数 schema；发现过程没有执行乘法。', ['n0','n1'], {n0:'tools/list',n1:'返回工具清单',n2:'people + price',n3:'executions:0'}, move('n0','n1','能力发现'), proof('代码对应 discover', 'name:meal_total；required:[people,price]；executions=0。')),
    frame('prepare', '按契约组装人数与单价。', '调用使用 people=17、price=23；schema 描述形状，本地策略决定是否允许。', ['n0','n2'], {n0:'tools/call',n1:'allowCall:true',n2:'17人 × 23元',n3:'等待检查'}, [], proof('callRequest.params', 'name:meal_total，arguments:{people:17,price:23}。')),
    frame('execute', '策略与参数通过后才执行。', '本地函数得到 total=391，并把 executions 增加到 1；结果装进 content 返回。', ['n1','n2','n3'], {n0:'等待响应',n1:'校验通过',n2:'total:391',n3:'executions:1'}, [...move('n1','n2','合法参数'),...move('n2','n3','391')], proof('代码对应 invoke', 'result.content 包含 total:391；isError:false。')),
    frame('deny', '只把 allowCall 改为 false。', '工具仍可被发现，但调用被本地策略拒绝，executions 保持 0。', ['n1','n3'], {n0:'列表仍存在',n1:'本地策略拒绝',n2:'未执行',n3:'error:-32001；执行0次'}, [], proof('动手只改这里', 'allowCall:true → false；对照 discovery、response 与 executions。')),
  ], '教学例子与代码同值；本地 JSON-RPC 风格子集，省略真实服务、传输、初始化与鉴权。−32001 是自定义策略码。'),

  film('multi-agent', '下一角色只能核验实际收到的交接', '金额没变，为什么少了来源就被退回？', line('任务与菜单', 'researcher', 'reviewer', '交付状态'), [
    frame('task', '给资料角色人数与菜单来源。', '任务有 17 人，menu 记载每人 23 元；两个角色是确定性的本地函数。', ['n0'], {n0:'17人；menu:23元',n1:'等待整理',n2:'等待交接',n3:'未验收'}, [], proof('代码对应 input', 'task={people:17,price:23}；includeSources=true。')),
    frame('handoff', '把金额、事实和来源一起交接。', 'researcher 返回 total=391、facts 与 sourceIds:[menu]，下一角色据此核验。', ['n1','n2'], {n0:'事实来源可回查',n1:'391 + facts + menu',n2:'读取 packet',n3:'等待规则检查'}, move('n1','n2','结构化 packet'), proof('代码对应 handoff', 'packet:total=391，sourceIds=[menu]，facts={people:17,price:23}。')),
    frame('review', '检查金额一致，也检查来源有效。', '391 等于 17×23，menu 也存在，所以 accepted=true，状态为可交付。', ['n2','n3'], {n0:'共享资料 menu',n1:'交接完整',n2:'issues:[]',n3:'可交付'}, move('n2','n3','accepted:true'), proof('代码对应 review', 'review.accepted=true；issues=[]。')),
    frame('missing-source', '只把 includeSources 改为 false。', '金额仍为 391，但 packet 丢了来源；核验器明确退回，角色数量不能补回信息。', ['n1','n2','n3'], {n0:'原始菜单仍在',n1:'sourceIds:[]',n2:'缺少有效来源',n3:'退回补充'}, move('n2','n3','accepted:false'), proof('动手只改这里', 'includeSources:true → false；total 不变，review.accepted 变为 false。')),
  ], '教学例子与代码同值；两个本地角色函数，不是两个自主大模型 Agent，也没有真实并行。'),
];

export function getChapterFilm(lessonId: string): ChapterFilmDefinition | undefined {
  return CHAPTER_FILMS.find(item => item.lessonId === lessonId);
}
