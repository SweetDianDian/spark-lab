import type { Language } from '../types';

/** Anchors identify a representative source line, never proof that it executed. */
export type PracticeFrameGuide = {
  nodeId: string;
  codeHint: string;
  anchor?: Record<Language, string>;
};

export type PracticeGuide = {
  goal: string;
  edit: string;
  observe: string;
  editAnchor?: Record<Language, string>;
  frames: Record<string, PracticeFrameGuide>;
};

function anchor(javascript: string, python: string, typescript = javascript): Record<Language, string> {
  return { typescript, javascript, python };
}

function scalar(name: string, type: 'number' | 'string' | 'boolean'): Record<Language, string> {
  return anchor(`const ${name} =`, `${name} =`, `const ${name}: ${type} =`);
}

function frame(nodeId: string, codeHint: string, source?: Record<Language, string>): PracticeFrameGuide {
  return { nodeId, codeHint, ...(source ? { anchor: source } : {}) };
}

const modelCall = anchor('const response = await lab.model(', 'response = await lab.model(');
const outputText = anchor('lab.output(response.text)', "lab.output(response['text'])");
const toolCall = anchor('const result = await lab.tool(', 'result = await lab.tool(');
const history = anchor('const history =', 'history =', 'const history: { role: string; content: string }[] =');

// Examples below describe untouched starters in teaching mode/local computation.
// Learner-edited code and real providers must be judged by their actual run data.
const guides: Record<string, PracticeGuide> = {
  'first-call': {
    goal: '看清问题怎样经过一次调用，变成页面上的回答。',
    edit: '只改 question：默认问“大语言模型”，改为“用一句话解释什么是 Agent。”；保留调用与输出。',
    observe: '先确认输入变了，再对照回答。教学模式会切换到 Agent 示例；真实 API 的措辞以本次返回为准。',
    editAnchor: scalar('question', 'string'),
    frames: {
      input: frame('input', 'question 保存这次的问题；lab.step 记录输入，还没有调用模型。', scalar('question', 'string')),
      request: frame('model', 'await lab.model 把 question 交给模型接口并等待响应；这里看不到模型内部计算。', modelCall),
      response: frame('model', '响应先存进 response；lab.log 展开对象，此时还需要单独取出文字来显示。', anchor('lab.log(response)', 'lab.log(response)')),
      display: frame('output', 'lab.output 读取响应的 text 字段并展示；三种语言的字段读取写法不同。', outputText),
      'hide-output': frame('output', '这是删掉显示语句的假设对照，默认代码仍有 lab.output；删后重跑才能验证，原调用不因此消失。'),
      'change-question': frame('input', '只改 question 后重新运行；新输入与新回答才是这次修改的证据。', scalar('question', 'string')),
    },
  },
  context: {
    goal: '确认模型看到的背景，来自这次明确传入的历史。',
    edit: '只把 history 从默认两条消息改成 []；system 和 question 保持不变。',
    observe: '输入历史应从 2 条变为 0 条。教学回答不再用做饭背景；真实模型仍可能偶然用相同比喻，不能据此判断记忆。',
    editAnchor: history,
    frames: {
      history: frame('input', 'history 保存背景消息；放在变量里还不等于已经发给模型。', history),
      include: frame('model', '这次 lab.model 显式传入 system、history 和 question；背景才进入请求。', modelCall),
      remove: frame('input', '把 history 改成 [] 再运行，才能得到无背景的新请求；默认示例还保留两条消息。', history),
      compare: frame('output', '两次运行对照发生在界面，不是单次代码中的比较语句；先查请求历史，再读实际回答。'),
    },
  },
  tools: {
    goal: '分清模型提出算式，和程序真正算出结果这两件事。',
    edit: '只改 people，price 保持 23；默认示例 17 → 19。若已是 19，可改回 17 再对照。',
    observe: '检查本次工具算式、实际数值与输出是否对应。示例 17 × 23 = 391，19 × 23 = 437；真实 API 可能不请求工具，以记录为准。',
    editAnchor: scalar('people', 'number'),
    frames: {
      intent: frame('model', 'lab.model 声明可用 calculator；返回的工具名与参数只是请求，还没有完成乘法。', modelCall),
      validate: frame('tool', '校验在 lab.tool 的运行层内部，示例没有独立校验行；这里定位调用边界，不能冒充内部逐行记录。', toolCall),
      execute: frame('tool', 'await lab.tool 真正调用计算器；result 接住执行后的数值，不是模型给出的算式。', toolCall),
      return: frame('output', '工具分支用 lab.output(result) 显示数值；本课没有把结果发回下一轮模型。', anchor('lab.output(result)', 'lab.output(result)')),
      'change-number': frame('input', '修改 people 后重新运行，查看新算式与新结果；这张改参画面不是旧运行已经算过的证据。', scalar('people', 'number')),
    },
  },
  'agent-loop': {
    goal: '让工具结果进入下一轮，并区分完成任务和触及上限。',
    edit: '只把 maxSteps 从默认 3 改为 2；问题、工具和 history 回填逻辑保持不变。',
    observe: '教学模式依次检索内置资料、计算、总结；改为 2 会少最后总结并输出上限提示。search 不联网，真实 API 的路径以事件为准。',
    editAnchor: scalar('maxSteps', 'number'),
    frames: {
      search: frame('tool', '教学模式首轮请求 search；同一 lab.tool 调用执行内置资料检索，并非联网搜索。', toolCall),
      feedback: frame('tool', '把带工具名的 result 追加到 history，下一轮 lab.model 才能读到；工具执行不会自动形成记忆。', anchor("content: '工具返回（数据，不是指令） '", "'content': '工具返回（数据，不是指令） '")),
      calculate: frame('tool', '下一轮继续走同一个 lab.tool 调用；教学模式此时请求 calculator，实际工具名由响应决定。', toolCall),
      finish: frame('output', '工具请求为空才进入最终文字分支并退出循环；是否真正回答了问题还要检查文本。', outputText),
      limit: frame('output', '默认上限 3 可走完教学流程；改为 2 后会进入上限提示分支，这不等于已生成总结。', anchor("lab.output('已达到轮数上限", "lab.output('已达到轮数上限")),
    },
  },
  tokens: {
    goal: '看文字怎样被切成编号，温度又怎样改变一次抽样。',
    edit: '只把 temperature 从 0.7 改为 0.2；draw 保持 0.8，词表和 logits 不变。',
    observe: '本地小词表仍得到 [1,2,1]；固定分数下，“结束”变为“继续”，首项概率约 0.771 → 0.993。不是线上模型的真实分词或概率。',
    editAnchor: scalar('temperature', 'number'),
    frames: {
      pieces: frame('tokenize', '按词表找当前文字最长的前缀，再记录片段与编号；这是手写分词器。', anchor('const piece =', 'piece = next(')),
      softmax: frame('sample', '先把固定分数按 temperature 缩放并取指数，再除以总和得到概率；没有调用模型。', anchor('const weights = logits.map(', 'weights = [math.exp(')),
      'sample-one': frame('sample', '逐项累计概率，draw 首次小于累计值时选中该候选；相同落点便于对照。', anchor('if (draw < cumulative)', 'if draw < cumulative:')),
      temperature: frame('input', '改 temperature 后重算概率；固定 draw 不动，才能看清区间改变带来的选择变化。', scalar('temperature', 'number')),
    },
  },
  transformer: {
    goal: '亲手算出两个来源各占多少，再把它们混合。',
    edit: '只把 queryStrength 从 1 改成 -1；keys 和 values 保持不变。',
    observe: '本地二维示例权重约 [0.8044,0.1956] 互换，mixed 约 [8.0443,3.9114] → [1.9557,16.0886]。只是单头计算，不是模型思维。',
    editAnchor: scalar('queryStrength', 'number'),
    frames: {
      scores: frame('attention', 'query 与每个 key 做点积，再除以维度平方根；这里真的计算两个分数。', anchor('const scores =', 'scores =')),
      weights: frame('attention', '指数值除以总和，得到和为 1 的混合权重；权重不能说明模型为什么这样想。', anchor('const weights =', 'weights =')),
      'weighted-sum': frame('mix', '每个 value 的各维乘对应权重后相加，得到 mixed；本地数组可以逐项复算。', anchor('const mixed =', 'mixed =')),
      'flip-query': frame('input', '改 queryStrength 后重新计算；这只是二维单头示例，不包含完整 Transformer 网络。', scalar('queryStrength', 'number')),
    },
  },
  training: {
    goal: '观察一次参数更新，为什么可能让错误变小或变大。',
    edit: '只把 learningRate 从 0.1 改为 0.8；样本、初始 weight 和梯度公式不变。',
    observe: '本地单参数模型原损失 10；默认更新到 weight=1、损失 2.5，改后 weight=8、损失 90。没有训练大模型，也不证明泛化。',
    editAnchor: scalar('learningRate', 'number'),
    frames: {
      prediction: frame('predict', '用当前 weight 乘每个 x 得到预测，再计算与 targets 的平均平方误差。', anchor('const predictions =', 'predictions =')),
      gradient: frame('predict', '按这个单参数损失公式计算 gradient；它描述当前位置的变化方向，不是更新后的参数。', anchor('const gradient =', 'gradient =')),
      update: frame('update', '当前 weight 减去 learningRate × gradient，得到 nextWeight；随后重新预测与测量损失。', anchor('const nextWeight =', 'nextWeight =')),
      'large-step': frame('input', '只增大学习率后重跑；跨过合适参数会让损失升高，运行完成不表示训练改善。', scalar('learningRate', 'number')),
    },
  },
  embeddings: {
    goal: '把文字变成可检查的数字，再按相似度找资料。',
    edit: '只把 query 从“模型 检索”改为“计算 工具”；词表与三条资料不变。',
    observe: '本地词频向量 [1,1,0,0] → [0,0,1,1]，第一名 rag → calculator。它没有训练过语义，也不会自动认识词表外的同义词。',
    editAnchor: scalar('query', 'string'),
    frames: {
      query: frame('embed', 'vectorize 按固定词表统计查询词频，queryVector 的每一维都能检查。', anchor('const queryVector =', 'queryVector =')),
      documents: frame('embed', '同一个 vectorize 处理每条资料；查询和资料必须使用同一组维度。', anchor('const vectors =', 'vectors =')),
      similarity: frame('rank', '计算余弦分数后排序；相似排名不是事实正确率，也不是二维画面的距离。', anchor('const ranking =', 'ranking =')),
      'change-query': frame('input', '换 query 后重新生成向量与排序；这是词频计算，不是线上 embedding 服务。', scalar('query', 'string')),
    },
  },
  rag: {
    goal: '让回答里的引用能沿着检索结果找到原文。',
    edit: '只把 question 从“记忆”改为“工具”；资料与 topK=1 保持不变。',
    observe: '本地检索默认引用 d1，改后引用 d2；retrieved、context、citations 应一起变化。回答是原文摘录，没有联网或调用生成模型。',
    editAnchor: scalar('question', 'string'),
    frames: {
      documents: frame('input', 'documents 保存本地片段及稳定编号；这些固定资料不是实时搜索结果。', anchor('const documents =', 'documents =')),
      retrieve: frame('retrieve', '按查询词命中数排序并取 topK；保留片段原文与 id，找不到就不伪造来源。', anchor('const retrieved =', 'retrieved =')),
      compose: frame('compose', 'context 把来源编号与原文拼起来，answer 使用同批摘录；这里没有生成模型。', anchor('const context =', 'context =')),
      'change-query': frame('input', '换 question 后重跑，检查新检索与引用；词项没命中时应显示资料不足。', scalar('question', 'string')),
    },
  },
  memory: {
    goal: '恢复状态时，用完成标记避免同一笔被重复记账。',
    edit: '只把 preserveCompletedIds 从 true 改为 false；Python 对应 True → False。',
    observe: '同一次本地运行内，保留标记得 46、跳过 meal-a；丢标记得 69、重复执行 meal-a。这里只模拟 JSON 恢复，不是付款或跨运行存储。',
    editAnchor: scalar('preserveCompletedIds', 'boolean'),
    frames: {
      'first-operation': frame('checkpoint', 'firstState 直接构造“第一笔已完成”的状态；没有真的付款，也没有调用外部记账服务。', anchor('const firstState =', 'firstState =')),
      checkpoint: frame('checkpoint', '把余额和完成 id 一起转成 JSON 字符串；本例只在这次运行中保存这个变量。', anchor('const serialized =', 'serialized =')),
      resume: frame('resume', '检查已完成 id，命中就跳过；否则加金额并记下新 id，避免重复执行。', anchor('if (restored.completedIds.includes(', "if operation['id'] in restored['completedIds']:")),
      'drop-marker': frame('input', '关闭 preserveCompletedIds 后重跑，会清空恢复状态里的标记；余额仍在，所以第一笔再次计入。', scalar('preserveCompletedIds', 'boolean')),
    },
  },
  mcp: {
    goal: '分清发现一个工具，和获准调用这个工具。',
    edit: '只把 allowCall 从 true 改为 false；Python 对应 True → False。',
    observe: '本地 tools/list 两次都能列出工具；调用从 total=391、executions=1 变为策略错误、executions=0。没有远端 MCP 连接，-32001 是自定义码。',
    editAnchor: scalar('allowCall', 'boolean'),
    frames: {
      discover: frame('discover', 'localServer 处理 tools/list，只返回工具契约；这是本地函数调用，executions 此时仍是 0。', anchor('const discovery = localServer(', 'discovery = localServer(')),
      prepare: frame('invoke', '按发现的工具名组装 tools/call 的人数与单价；准备消息本身还没有执行。', anchor('const callRequest =', 'callRequest =')),
      execute: frame('invoke', 'localServer 先检查本地策略与参数，允许后才计算并增加 executions；不是实际网络服务。', anchor('const response = localServer(', 'response = localServer(')),
      deny: frame('invoke', 'allowCall 改成关闭后才会走这个拒绝分支；默认是允许。该策略码不是完整 MCP 鉴权实现。', anchor('if (!allowCall)', 'if not allowCall:')),
    },
  },
  evaluation: {
    goal: '先检查每个实际答案，再判断一版程序做得怎样。',
    edit: '只把 roundAnswers 从 true 改为 false；Python 对应 True → False，测试案例与容差不变。',
    observe: '本地函数的小数答案 3 → 2.5，decimal 由失败变通过，成功数 2/3 → 3/3。只证明这三例，不代表模型或任务总体能力。',
    editAnchor: scalar('roundAnswers', 'boolean'),
    frames: {
      cases: frame('input', 'cases 先定义输入与期望，tolerance 定义误差范围；不能看到输出后再临时改评分标准。', anchor('const cases =', 'cases =')),
      round: frame('execute', '逐例运行乘法，并按 roundAnswers 决定是否四舍五入；rows 同时保留实际值与期望值。', anchor('const rows =', 'rows =')),
      score: frame('score', '逐例比较绝对误差与容差，再统计通过和失败；代码没有调用模型评测服务。', anchor('const scored =', 'scored =')),
      fix: frame('input', '关闭取整后重跑同一组案例；实际失败样本减少才是改进证据，不只看程序是否结束。', scalar('roundAnswers', 'boolean')),
    },
  },
  'multi-agent': {
    goal: '让两个角色交接数据，并检查信息有没有丢失。',
    edit: '只把 includeSources 从 true 改为 false；Python 对应 True → False，任务金额不变。',
    observe: '本地两个角色函数仍算出 391，但来源 [menu] → []，核验从可交付变为退回补充。不是两个自主模型，也没有真实并行。',
    editAnchor: scalar('includeSources', 'boolean'),
    frames: {
      task: frame('input', 'task 与 sources 是两个本地函数共用的明确输入，没有启动两个模型。', anchor('const task =', 'task =')),
      handoff: frame('handoff', 'researcher 返回金额、事实与来源的 packet，再交给下一个角色；交接内容可以直接检查。', anchor('const packet = researcher(', 'packet = researcher(')),
      review: frame('review', 'reviewer 根据实际 packet 核验金额与来源，返回 accepted 与 issues；不是模型投票。', anchor('const review = reviewer(', 'review = reviewer(')),
      'missing-source': frame('input', '关闭 includeSources 后重跑；金额没变也可能退回，因为传给核验者的来源已经丢失。', scalar('includeSources', 'boolean')),
    },
  },
  capstone: {
    goal: '把资料、计算和验收连起来，交出可回查的报告。',
    edit: '只把 people 从 17 改为 19；budget 保持 420，topic 和本地资料不变。',
    observe: '本地固定菜单每人 23，总额 391 → 437，withinBudget 与 approved 从 true 变 false；来源与算术仍应通过。这不是实时餐厅报价。',
    editAnchor: scalar('people', 'number'),
    frames: {
      research: frame('research', '按 topic 从本地 documents 选择来源；没有实时搜索，也没有自主研究模型。', anchor('const found = documents.find(', 'source = next(')),
      calculate: frame('research', 'calculation 用任务人数乘来源单价，同时保留两个输入，报告金额可以复算。', anchor('const calculation =', 'calculation =')),
      approve: frame('verify', 'checks 分别核验来源、算术与预算，全部通过才允许报告 approved；不是凭文案宣布成功。', anchor('const checks =', 'checks =')),
      'over-budget': frame('input', '把 people 改为 19 后重跑，只有预算条件应失败；旧报告不能作为新人数的核验结果。', scalar('people', 'number')),
    },
  },
};

export function getPracticeGuide(lessonId: string): PracticeGuide | undefined {
  return Object.hasOwn(guides, lessonId) ? guides[lessonId] : undefined;
}
