import type { RunEvent, RunResult } from '../types';

export type LessonValidation = { passed: boolean; reason: string };
export type NodeExecutionState = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Zero and false are legitimate results. Empty strings, missing values and
// empty containers cannot stand in for an observed lesson output.
function hasContent(value: unknown, depth = 0): boolean {
  if (value === null || value === undefined || depth > 8) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.some(item => hasContent(item, depth + 1));
  if (isRecord(value)) return Object.values(value).some(item => hasContent(item, depth + 1));
  return false;
}

function ordered(events: RunEvent[]): RunEvent[] {
  return [...events].sort((a, b) => a.seq - b.seq);
}

function isModelCompletion(event: RunEvent): boolean {
  return event.type === 'model.completed' && event.nodeId === 'model' &&
    isRecord(event.data) && typeof event.data.text === 'string' && Array.isArray(event.data.toolCalls);
}

function isToolCompletion(event: RunEvent): boolean {
  return event.type === 'tool.completed' && event.nodeId === 'tool' &&
    isRecord(event.data) && ['calculator', 'search'].includes(String(event.data.name)) && hasContent(event.data.result);
}

const notYet = (reason: string): LessonValidation => ({ passed: false, reason });

/** Checks observed execution evidence, not source text or a zero exit code.
 * This is a learning checkpoint, not an anti-cheating or security boundary. */
export function validateLessonRun(lessonId: string, result: RunResult | null): LessonValidation {
  if (!result) return notYet('先运行一次实验，让代码留下可观察的执行过程。');
  if (result.status === 'cancelled') return notYet('这次运行已停止。让实验完整结束后，再来点亮这一章。');
  if (result.status === 'failed') return notYet('这次运行还没有成功。先查看错误节点，修改后再试一次。');
  if (!['first-call', 'context', 'tools', 'agent-loop'].includes(lessonId)) {
    return notYet('这一章目前开放原理预览，完整实验还在准备中。');
  }
  const events = ordered(result.events);
  const terminal = events.filter(event => ['run.completed', 'run.failed', 'run.cancelled'].includes(event.type)).at(-1);
  if (terminal?.type === 'run.failed') return notYet('执行记录显示运行失败，请先修复错误再试。');
  if (terminal?.type === 'run.cancelled') return notYet('执行记录显示运行已停止，请完成一次完整实验。');
  const models = events.filter(isModelCompletion);
  if (!models.length) return notYet('还没有观察到模型完成调用。试着使用 await lab.model(...)，再展示它的回答。');

  const outputEvent = events.filter(event => event.type === 'output' && event.nodeId === 'output').at(-1);
  if (!outputEvent || !hasContent(outputEvent.data) || !hasContent(result.output)) {
    return notYet('模型已经运行，但还没有非空的最终输出。用 lab.output(...) 展示你观察到的结果。');
  }
  if (outputEvent.seq < models.at(-1)!.seq) {
    return notYet('最终输出发生在模型返回之前。请等待模型返回，再输出这次实验的结果。');
  }

  if (lessonId === 'tools') {
    const calculator = events.find(event => isToolCompletion(event) && isRecord(event.data) &&
      event.data.name === 'calculator' && isRecord(event.data.result) &&
      typeof event.data.result.expression === 'string' &&
      typeof event.data.result.result === 'number' && Number.isFinite(event.data.result.result));
    if (!calculator) return notYet('还没有观察到计算器执行成功。把模型提出的工具请求交给 lab.tool(...) 执行。');
    const requested = models.some(event => event.seq < calculator.seq && isRecord(event.data) &&
      Array.isArray(event.data.toolCalls) && event.data.toolCalls.some(call => isRecord(call) && call.name === 'calculator'));
    if (!requested) return notYet('计算器已经执行，但还缺少模型提出计算器请求的步骤。让模型先选择工具，再执行它。');
    if (outputEvent.seq < calculator.seq) return notYet('计算器已经完成，接着用 lab.output(...) 展示实际计算结果。');
    return { passed: true, reason: '模型提出请求，计算器实际执行，结果被展示出来。你已经跑通一次工具调用。' };
  }

  if (lessonId === 'agent-loop') {
    if (typeof result.output === 'string' && /(?:已达到|达到|触及|超过).*(?:轮数|步数|次数).*上限/.test(result.output)) {
      return notYet('程序安全地停在轮数上限，但 Agent 还没有完成回答。检查历史消息，或适当增加 maxSteps。');
    }
    if (models.length < 2) return notYet('还没有形成循环。至少让模型在工具执行之后，再带着结果思考一轮。');
    const lastModel = models.at(-1)!;
    const toolBetweenCalls = events.some(event => isToolCompletion(event) &&
      event.seq > models[0].seq && event.seq < lastModel.seq);
    if (!toolBetweenCalls) return notYet('还没有观察到“模型 → 工具 → 模型”的过程。将工具结果放进历史，再次调用模型。');
    const final = lastModel.data as Record<string, unknown>;
    if (!Array.isArray(final.toolCalls) || final.toolCalls.length !== 0 || !hasContent(final.text)) {
      return notYet('最后一轮仍在请求工具，或尚未给出回答。让循环继续，直到模型输出最终答案。');
    }
    return { passed: true, reason: 'Agent 已经调用工具、带回结果，并在后续一轮给出最终回答。循环真正闭合了。' };
  }

  return {
    passed: true,
    reason: lessonId === 'context'
      ? '这次上下文请求已经完成，回答也被展示出来。再改变一个变量，比较两次结果。'
      : '模型收到问题、返回回答，代码展示了结果。你的第一次模型调用已经完成。',
  };
}

/** Repeated calls on one node are read in event order: a new started event
 * returns that node to running even if a previous iteration completed. */
export function nodeExecutionState(events: RunEvent[], nodeId: string): NodeExecutionState {
  const timeline = ordered(events);
  let state: NodeExecutionState = 'idle';
  let outputExists = false;
  for (const event of timeline) {
    if (nodeId === 'output') {
      if (event.type === 'output' && event.nodeId === 'output') {
        outputExists = hasContent(event.data);
        state = outputExists ? 'completed' : 'idle';
      }
      if (event.type === 'run.completed') {
        const finalOutput = isRecord(event.data) && hasContent(event.data.output);
        state = finalOutput || outputExists ? 'completed' : 'idle';
      }
      if (event.type === 'run.failed') state = 'failed';
      if (event.type === 'run.cancelled') state = 'cancelled';
      continue;
    }

    if (nodeId === 'input') {
      if (event.type === 'run.started') state = 'running';
      if ((event.type === 'step' && event.nodeId === 'input') || event.type === 'model.started') state = 'completed';
    }
    if (event.nodeId === nodeId) {
      if (event.type === `${nodeId}.started`) state = 'running';
      if (event.type === `${nodeId}.completed`) state = 'completed';
      if (event.type === `${nodeId}.failed`) state = 'failed';
      if (event.type === `${nodeId}.cancelled`) state = 'cancelled';
    }
    // Preserve already-completed upstream steps when a later step fails. An
    // active node must not keep spinning after the overall run terminates.
    if (state === 'running' && event.type === 'run.failed') state = 'failed';
    if (state === 'running' && event.type === 'run.cancelled') state = 'cancelled';
  }
  return state;
}
