/** The four code experiments contribute to one small learning assistant. */
export type LessonJourney = {
  question: string;
  scenario: string;
  why: string;
  /** One change to the existing starter, after a baseline run. */
  change: string;
  /** Evidence learners can inspect in their own execution. */
  observe: readonly string[];
  takeaway: string;
  projectContribution: string;
};

const journeys: Record<string, LessonJourney> = {
  'first-call': {
    question: '怎样让助手接住一个问题，并显示回答？',
    scenario: '学习助手的第一个任务：用一句话解释什么是大语言模型。',
    why: '先接通问题、请求、响应与展示，后面的背景和工具才有地方接入。',
    change: '先运行原代码，再只把 question 改成“用一句话解释什么是 Agent。”，保留调用和输出代码。',
    observe: [
      '查看“准备问题”输入事件，确认第二次运行的问题确实换成了 Agent。',
      '展开模型响应，找到 text，再与最终输出对照：输出读取的是响应内容。',
      '对比两次回答的主题；教学模拟给出固定示例，真实 API 的措辞可能变化。',
    ],
    takeaway: '问题是输入，模型调用产生响应，展示响应是另一个步骤。',
    projectContribution: '一次回答：助手能接收问题并显示模型的回答。',
  },
  context: {
    question: '同一个概念，怎样讲给不同背景的人？',
    scenario: '用户没学过 AI、喜欢做饭；助手需要用他熟悉的例子解释大语言模型。',
    why: '只给问题，助手不知道读者的背景。需要把相关资料明确放进这次请求。',
    change: '先运行原代码，再只把 history 设为 []，移除“喜欢做饭”的背景；保留 system 和 question。',
    observe: [
      '对比“组装上下文”输入事件：system 与 question 相同，history 从 2 条变为 0 条。',
      '查看 messageCount 和两次回答，核对做饭比喻是否随背景变化。',
      '没有背景的真实模型也可能偶然使用相同比喻；应以请求中的消息判断它收到了什么。',
    ],
    takeaway: '上下文来自本次带入的消息，模型不会自动读取你的前一次运行。',
    projectContribution: '有背景的解释：助手能按请求携带的用户背景组织回答。',
  },
  tools: {
    question: '模型给出一个算式后，谁真正算出了总费用？',
    scenario: '助手为 17 人计算费用，每人 23 元；程序接住计算器请求，执行后展示总费用。',
    why: '模型提出的计算请求还不是结果。程序必须检查参数、执行工具，再使用返回值。',
    change: '只把人数 people 从 17 改成 19，保持单价 price = 23 与工具执行代码不变。',
    observe: [
      '先看“准备费用问题”中的人数和单价，再核对 calculator 请求的 expression 是否为 19 * 23。',
      '沿工具输入追到返回结果，确认总费用从 391 元变为 437 元。',
      '最终输出应来自工具返回值；若不一致，沿请求参数、工具输入和输出逐项定位。',
    ],
    takeaway: '模型提出工具请求，程序校验并执行；可靠的数字需要可检查的计算依据。',
    projectContribution: '有依据的计算：助手能展示真正执行计算器得到的数值。',
  },
  'agent-loop': {
    question: '一个任务要查询、计算、总结，怎样接着做并适时停下？',
    scenario: '助手先从内置教学资料查询 RAG，再计算 17 × 23，最后用两句话总结。',
    why: '一次工具结果只是中间步骤。要把结果带回下一轮请求，并为循环设置停止条件。',
    change: '先用 maxSteps = 3 运行，再只把 maxSteps 改成 2；保持问题、工具和 history 更新逻辑不变。',
    observe: [
      '检查“设定任务与上限”输入事件，确认两次任务相同，只有轮数上限从 3 变为 2。',
      '逐轮查看已执行的 search、calculator 及其返回值，核对结果是否进入下一次请求。',
      '教学模拟在第 3 轮总结；上限为 2 时已有资料和计算结果，但输出停机提示。真实 API 可能采用不同工具路径，应以实际调用轮数和停止输出为准。',
    ],
    takeaway: 'Agent 循环连接请求、工具结果与下一轮输入；停止运行和完成任务需要分别判断。',
    projectContribution: '多步完成任务：助手能带着工具结果继续，并在轮数上限处停下。',
  },
};

export function getLessonJourney(id: string): LessonJourney | undefined {
  return journeys[id];
}
