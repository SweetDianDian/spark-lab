import type { PracticeFrameGuide } from '../data/practice-guides';
import type { Language, RunEvent } from '../types';
import { nodeExecutionState, type NodeExecutionState } from './progress';

export type CodeLocation = { startLine: number; endLine: number; kind: 'related' | 'matched' };
export type ExecutionInspection = {
  state: NodeExecutionState;
  explanation: string;
  inputLabel: string;
  input: unknown;
  resultLabel: string;
  result: unknown;
  event?: RunEvent;
  location: CodeLocation | null;
  locationNote: string;
};
type CallSite = { method: string; argument: string; startLine: number; endLine: number };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const same = (a: unknown, b: unknown) => {
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
};

/** Masks comments and literals without changing offsets. No code is executed.
 * Unsupported dynamic aliases/template-expression calls deliberately get no location. */
function codeMask(code: string, language: Language): string {
  const chars = code.split('');
  const blank = (start: number, end: number) => { for (let i = start; i < end; i++) if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' '; };
  let i = 0;
  while (i < code.length) {
    if ((language === 'python' && code[i] === '#') || (language !== 'python' && code.startsWith('//', i))) {
      const end = code.indexOf('\n', i); const stop = end < 0 ? code.length : end; blank(i, stop); i = stop;
    } else if (language !== 'python' && code.startsWith('/*', i)) {
      const end = code.indexOf('*/', i + 2); const stop = end < 0 ? code.length : end + 2; blank(i, stop); i = stop;
    } else if (language !== 'python' && code[i] === '/' && /[=(:,!&|?;{}]/.test(code.slice(0, i).trim().at(-1) ?? '=')) {
      const start = i++; let characterClass = false;
      while (i < code.length && code[i] !== '\n') {
        if (code[i] === '\\') { i += 2; continue; }
        if (code[i] === '[') characterClass = true;
        if (code[i] === ']') characterClass = false;
        if (code[i++] === '/' && !characterClass) break;
      }
      blank(start, Math.min(i, code.length));
    } else if (['"', "'", '`'].includes(code[i])) {
      const start = i; const quote = code[i];
      const delimiter = language === 'python' && code.startsWith(quote.repeat(3), i) ? quote.repeat(3) : quote;
      i += delimiter.length;
      while (i < code.length) {
        if (code[i] === '\\') { i += 2; continue; }
        if (code.startsWith(delimiter, i)) { i += delimiter.length; break; }
        i++;
      }
      blank(start, Math.min(i, code.length));
    } else i++;
  }
  return chars.join('');
}

/** A teaching hint can point to source even before execution. Ignore strings and
 * comments, and leave ambiguous or removed lines for the learner to inspect. */
export function locateTeachingAnchor(code: string, language: Language, anchor?: string): CodeLocation | null {
  if (!anchor?.trim() || anchor.includes('\n')) return null;
  const fragment = anchor.trim();
  const mask = codeMask(code, language);
  let matchLine: number | undefined;
  let start = 0;
  while (start < code.length) {
    const offset = code.indexOf(fragment, start);
    if (offset < 0) break;
    start = offset + fragment.length;
    if (!mask.slice(offset, start).trim()) continue;
    if (/^[\w$]/.test(fragment) && /[\w$]/.test(code[offset - 1] ?? '')) continue;
    if (/[\w$]$/.test(fragment) && /[\w$]/.test(code[start] ?? '')) continue;
    if (matchLine !== undefined) return null;
    matchLine = code.slice(0, offset).split('\n').length;
  }
  return matchLine === undefined ? null : { startLine: matchLine, endLine: matchLine, kind: 'related' };
}

function callSites(code: string, language: Language): CallSite[] {
  const mask = codeMask(code, language);
  const pattern = /\blab\s*\.\s*(step|model|tool|output)\s*\(/g;
  const found: CallSite[] = [];
  for (const match of mask.matchAll(pattern)) {
    const start = match.index!; const open = start + match[0].length - 1;
    // Do not treat other.lab.tool or declarations as a call on the lab API.
    if (start > 0 && /[\w$.]/.test(mask[start - 1])) continue;
    let depth = 1; let end = open + 1;
    for (; end < mask.length && depth; end++) { if (mask[end] === '(') depth++; else if (mask[end] === ')') depth--; }
    if (depth) continue;
    found.push({ method: match[1], argument: code.slice(open + 1, end - 1).trim(), startLine: code.slice(0, start).split('\n').length, endLine: code.slice(0, end).split('\n').length });
  }
  return found;
}

function outputMatch(argument: string, event: RunEvent, before: RunEvent[]): boolean | undefined {
  if (/^result$/.test(argument)) {
    const tool = before.filter(e => e.type === 'tool.completed').at(-1);
    return !!tool && object(tool.data) && same(event.data, tool.data.result);
  }
  if (/^response(?:\.text|\[['"]text['"]\])$/.test(argument)) {
    const model = before.filter(e => e.type === 'model.completed').at(-1);
    return !!model && object(model.data) && same(event.data, model.data.text);
  }
  const prefixed = /^(['"])(.*?)\1\s*\+\s*response(?:\.text|\[['"]text['"]\])$/.exec(argument);
  if (prefixed && !prefixed[2].includes('\\')) {
    const model = before.filter(e => e.type === 'model.completed').at(-1);
    return !!model && object(model.data) && event.data === prefixed[2] + model.data.text;
  }
  const literal = /^(['"])([\s\S]*)\1$/.exec(argument);
  if (literal && !literal[2].includes(literal[1]) && !literal[2].includes('\\')) return event.data === literal[2];
  return undefined;
}

function locate(code: string, language: Language, nodeId: string, events: RunEvent[], event: RunEvent | undefined, matchesSnapshot: boolean): { location: CodeLocation | null; locationNote: string } {
  if (events.length && !matchesSnapshot) return { location: null, locationNote: '编辑器与这次运行的代码不同。以下是旧证据，暂不定位执行行；重新运行后再联动。' };
  const all = callSites(code, language);
  const isStep = !['model', 'tool', 'output'].includes(nodeId);
  let candidates = all.filter(call => isStep
    ? call.method === 'step' && /^(['"])([a-z][a-z0-9-]*)\1\s*,/.exec(call.argument)?.[2] === nodeId
    : call.method === nodeId);
  if (nodeId === 'input' && !candidates.length) candidates = all.filter(call => call.method === 'model');
  if (nodeId === 'output' && event?.type === 'output' && candidates.length > 1) {
    const before = events.filter(item => item.seq < event.seq);
    const matches = candidates.map(call => outputMatch(call.argument, event, before));
    // An unknown expression may produce the same value. Do not guess its branch.
    if (!matches.includes(undefined)) candidates = candidates.filter((_call, index) => matches[index]);
  }
  if (candidates.length !== 1) return { location: null, locationNote: candidates.length ? '有多处可能的调用，事件没有源码位置，不能唯一确定执行行。可在执行记录中核对数据。' : '当前代码中没有可唯一关联的 lab 调用；只展示实际事件，不猜测执行行。' };
  const { startLine, endLine } = candidates[0];
  const observed = !!event && !['run.started', 'run.completed', 'run.failed', 'run.cancelled'].includes(event.type);
  return { location: { startLine, endLine, kind: observed ? 'matched' : 'related' }, locationNote: observed ? `对应第 ${startLine}${endLine === startLine ? '' : `–${endLine}`} 行 · 根据调用与事件值匹配，非逐行调试追踪。` : `相关代码第 ${startLine} 行 · 本步骤还没有执行证据。` };
}

export function locateFrameInCode(code: string, language: Language, frame: PracticeFrameGuide) {
  const anchor = frame.anchor?.[language];
  return anchor ? locateTeachingAnchor(code, language, anchor) : locate(code, language, frame.nodeId, [], undefined, true).location;
}

/** Uses only visible events, and pairs the latest invocation with its own result. */
export function inspectExecution(args: { lessonId: string; nodeId: string; nodeDescription?: string; localSteps?: boolean; events: RunEvent[]; code: string; language: Language; matchesSnapshot: boolean }): ExecutionInspection {
  const { lessonId, nodeId, code, language, matchesSnapshot } = args;
  const events = [...args.events].sort((a, b) => a.seq - b.seq);
  const state = nodeExecutionState(events, nodeId);
  let event: RunEvent | undefined;
  let input: unknown = null; let result: unknown = null;
  let inputLabel = '实际输入'; let resultLabel = '实际结果';
  let explanation = '';
  if ((args.localSteps && nodeId === 'input') || !['input', 'output', 'model', 'tool'].includes(nodeId)) {
    event = events.filter(item => item.type === 'step' && item.nodeId === nodeId).at(-1);
    const data = event?.data;
    if (object(data) && 'input' in data && 'result' in data) {
      input = data.input;
      result = data.result;
    } else if (nodeId === 'input') input = data ?? null;
    else result = data ?? null;
    explanation = object(data) && typeof data.explanation === 'string' ? data.explanation
      : args.nodeDescription ?? '点击运行，核对这一步记录的输入与结果。';
  } else if (nodeId === 'input') {
    event = events.filter(item => item.type === 'step' && item.nodeId === 'input').at(-1);
    input = event?.data ?? events.find(item => item.type === 'model.started')?.data ?? null;
    result = events.find(item => item.type === 'model.started')?.data ?? null;
    resultLabel = '交给模型的请求';
    explanation = lessonId === 'tools' ? '先把人数、单价和问题准备好。模型只会收到这次明确交给它的请求。'
      : lessonId === 'context' ? '问题、规则和历史消息在这里组装。模型不会自动读取前一次运行的背景。'
        : lessonId === 'agent-loop' ? '先确定任务与轮数上限。后续工具结果需要由程序带回下一轮请求。' : '问题先进入请求，模型返回和展示回答是后面的两个步骤。';
  } else if (nodeId === 'model' || nodeId === 'tool') {
    const invocation = events.filter(item => item.type.startsWith(`${nodeId}.`));
    event = invocation.at(-1);
    const start = invocation.filter(item => item.type === `${nodeId}.started` && (!event || item.seq <= event.seq)).at(-1);
    input = start?.data ?? null;
    if (event && event.type !== `${nodeId}.started` && (!start || event.seq >= start.seq)) result = event.data;
    if (nodeId === 'tool') {
      explanation = '这里才由程序执行工具。模型提出的名称和参数先经过校验，执行完成后才有真正的结果。';
      if (object(result) && 'result' in result) result = result.result;
    } else {
      const asksTool = object(result) && Array.isArray(result.toolCalls) && result.toolCalls.length > 0;
      explanation = asksTool ? '模型这次返回了工具名称与参数。它只是提出请求，程序还要执行对应工具。' : '模型接收本次请求并返回响应。text 是回答，toolCalls 表示它是否还想调用工具。';
    }
  } else {
    event = events.filter(item => item.type === 'output' && item.nodeId === 'output').at(-1);
    result = event?.data ?? null;
    const before = events.filter(item => !event || item.seq < event.seq);
    const tool = before.filter(item => item.type === 'tool.completed' && object(item.data) && same(item.data.result, result)).at(-1);
    const model = before.filter(item => item.type === 'model.completed' && object(item.data) && same(item.data.text, result)).at(-1);
    const lastStep = args.localSteps && event ? before.filter(item => item.type === 'step').at(-1) : undefined;
    input = lastStep ? object(lastStep.data) && 'result' in lastStep.data ? lastStep.data.result : lastStep.data : tool?.data ?? model?.data ?? null;
    inputLabel = lastStep ? '上一步记录' : '前一步的返回值';
    explanation = args.localSteps ? (args.nodeDescription ?? '检查程序交给 lab.output 的最终数据。') : typeof result === 'string' && /已达到.*轮数上限/.test(result) ? '程序在轮数上限处停止了。这是停机提示，不代表 Agent 已经完成任务。'
      : tool ? '这里展示的值与本次工具返回值一致。模型请求、工具执行、展示结果是三件不同的事。'
        : 'lab.output 把程序拿到的值展示出来。没有调用它，就不能把模型返回自动当作最终输出。';
  }
  if (state === 'running') resultLabel = '等待本次返回';
  if (state === 'failed' || state === 'cancelled') {
    const failure = events.filter(item => item.type === `${nodeId}.failed` || item.type === 'run.failed' || item.type === 'run.cancelled').at(-1);
    result = failure?.data ?? result;
    resultLabel = state === 'failed' ? '本次错误' : '停止信息';
    explanation = state === 'failed' ? '这一步没有完成。检查真实输入与错误信息，不能沿用前一次成功的结果。' : '运行已停止。已经发生的步骤仍是记录，未完成的调用没有新结果。';
  }
  return { state, explanation, inputLabel, input, resultLabel, result, event, ...locate(code, language, nodeId, events, event, matchesSnapshot) };
}
