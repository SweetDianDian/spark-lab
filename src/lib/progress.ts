import type { RunEvent, RunResult } from '../types';
import { getAdvancedLab } from '../data/advanced-labs';

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

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const numbers = (value: unknown): value is number[] => Array.isArray(value) && value.length > 0 && value.every(finite);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');
const records = (value: unknown): value is Record<string, unknown>[] => Array.isArray(value) && value.every(isRecord);
const close = (a: unknown, b: number): boolean => finite(a) && Math.abs(a-b) <= 1e-8 * Math.max(1, Math.abs(b));
function equal(a: unknown, b: unknown): boolean {
  if (finite(a) && finite(b)) return close(a,b);
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item,index) => equal(item,b[index]));
  if (isRecord(a) && isRecord(b)) return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => Object.hasOwn(b,key) && equal(a[key],b[key]));
  return a === b;
}
type StepEvidence = { input: Record<string, unknown>; result: Record<string, unknown> };
function isStepEvidence(value: unknown): value is StepEvidence {
  return isRecord(value) && isRecord(value.input) && isRecord(value.result);
}
function probabilities(value: unknown): value is number[] {
  return numbers(value) && value.every(item => item >= 0 && item <= 1) && close(value.reduce((sum,item) => sum+item,0),1);
}
function normalizedExponents(values: number[], temperature = 1): number[] {
  const weights = values.map(value => Math.exp((value-Math.max(...values))/temperature));
  const total = weights.reduce((sum,value)=>sum+value,0);
  return weights.map(value=>value/total);
}

/** Check both a chapter's intermediate evidence and its transmission to output.
 * Negative findings (a failed evaluation case, rejected permission or budget)
 * are valid observations; fabricated success flags are not completion proof. */
function advancedEvidenceMatches(id: string, input: Record<string, unknown>, a: StepEvidence, b: StepEvidence, out: Record<string, unknown>): boolean {
  const first = a.result, last = b.result;
  switch (id) {
    case 'tokens': {
      if (typeof input.text !== 'string' || !strings(first.pieces) || !numbers(first.ids) || first.ids.length !== first.pieces.length || first.pieces.join('') !== input.text || !probabilities(last.probabilities) || !strings(b.input.candidates) || !finite(last.selectedIndex) || !Number.isInteger(last.selectedIndex) || !finite(b.input.draw) || !numbers(input.logits) || !finite(input.temperature) || input.temperature<=0 || !equal(b.input.logits,input.logits) || b.input.temperature!==input.temperature || b.input.draw!==input.draw) return false;
      const index = last.selectedIndex;
      const lower = last.probabilities.slice(0,index).reduce((sum,value)=>sum+value,0);
      return equal(last.probabilities,normalizedExponents(input.logits,input.temperature)) && index >= 0 && index < last.probabilities.length && last.probabilities.length === b.input.candidates.length && b.input.draw >= lower && b.input.draw < lower+last.probabilities[index] && last.selected === b.input.candidates[index] && equal(out.pieces,first.pieces) && equal(out.ids,first.ids) && equal(out.probabilities,last.probabilities) && out.selected === last.selected && out.temperature===input.temperature;
    }
    case 'transformer': {
      if (!numbers(input.query) || !Array.isArray(input.keys) || !input.keys.every(numbers) || !numbers(first.scores) || !probabilities(first.weights) || first.weights.length !== first.scores.length || !Array.isArray(b.input.values) || !b.input.values.every(numbers) || !numbers(last.mixed) || b.input.values.length !== first.weights.length || !equal(b.input.weights,first.weights)) return false;
      const values = b.input.values as number[][];
      const actualMixed = last.mixed as number[], weights = first.weights as number[];
      const query = input.query, keys = input.keys as number[][];
      if (!keys.every(key=>key.length===query.length)) return false;
      const scores = keys.map(key=>key.reduce((sum,value,index)=>sum+value*query[index],0)/Math.sqrt(query.length));
      if (!equal(first.scores,scores) || !equal(weights,normalizedExponents(scores))) return false;
      if (!values.every(value => value.length === actualMixed.length)) return false;
      const mixed = actualMixed.map((_,column) => values.reduce((sum,value,index) => sum+weights[index]*value[column],0));
      return equal(mixed,last.mixed) && equal(out.weights,first.weights) && equal(out.scores,first.scores) && equal(out.mixed,last.mixed);
    }
    case 'training': {
      if (!numbers(input.x) || !numbers(input.targets) || input.x.length !== input.targets.length || !finite(input.weight) || !finite(input.learningRate) || !finite(first.gradient) || !finite(first.lossBefore) || !finite(last.nextWeight) || !finite(last.lossAfter)) return false;
      const x = input.x, targets = input.targets, weight = input.weight;
      const predictions = x.map(value => weight*value);
      const before = predictions.reduce((sum,value,index)=>sum+(value-targets[index])**2,0)/x.length;
      const gradient = 2*x.reduce((sum,value,index)=>sum+(predictions[index]-targets[index])*value,0)/x.length;
      const next = weight-input.learningRate*gradient;
      const nextPredictions = x.map(value=>next*value);
      const after = nextPredictions.reduce((sum,value,index)=>sum+(value-targets[index])**2,0)/x.length;
      return equal(first.predictions,predictions) && close(first.lossBefore,before) && close(first.gradient,gradient) && equal(b.input.gradient,first.gradient) && close(last.nextWeight,next) && close(last.lossAfter,after) && equal(last.nextPredictions,nextPredictions) && equal(out.nextWeight,last.nextWeight) && equal(out.lossBefore,before) && equal(out.lossAfter,after) && out.improved === (after<before);
    }
    case 'embeddings': {
      if (typeof input.query !== 'string' || !strings(input.vocabulary) || !records(input.documents) || !numbers(first.queryVector) || !records(first.vectors) || !first.vectors.length || !records(last.ranking) || last.ranking.length !== first.vectors.length || !equal(b.input.queryVector,first.queryVector) || !equal(b.input.vectors,first.vectors)) return false;
      const query = first.queryVector;
      const vocabulary = input.vocabulary, documents = input.documents;
      const vectorize = (text: string) => vocabulary.map(word=>text.split(/\s+/).filter(token=>token===word).length);
      if (!equal(query,vectorize(input.query)) || first.vectors.length!==documents.length || !first.vectors.every(item=>documents.some(doc=>doc.id===item.id && doc.text===item.text && typeof doc.text==='string' && equal(item.vector,vectorize(doc.text))))) return false;
      let previous = Infinity;
      for (const row of last.ranking) {
        const vector = first.vectors.find(item => item.id === row.id)?.vector;
        if (!numbers(vector) || vector.length !== query.length || !finite(row.score) || row.score > previous+1e-9) return false;
        const norm = Math.hypot(...query)*Math.hypot(...vector);
        const expected = norm ? query.reduce((sum,value,index)=>sum+value*vector[index],0)/norm : 0;
        if (!close(row.score,expected)) return false;
        previous = row.score;
      }
      return equal(out.ranking,last.ranking) && out.bestMatch === last.ranking[0].id && equal(out.queryVector,query);
    }
    case 'rag': {
      if (typeof input.question !== 'string' || !finite(input.topK) || !Number.isInteger(input.topK) || input.topK<1 || !records(first.retrieved) || !records(input.documents) || !strings(last.citations) || typeof last.context !== 'string' || typeof last.answer !== 'string' || !equal(b.input.retrieved,first.retrieved)) return false;
      const documents = input.documents;
      if (!documents.every(doc=>typeof doc.text==='string')) return false;
      const terms = input.question.trim().split(/\s+/).filter(Boolean);
      const expected = documents.map(doc=>({...doc,score:terms.filter(term=>String(doc.text).includes(term)).length})).filter(doc=>doc.score>0).sort((a,b)=>b.score-a.score).slice(0,input.topK);
      if (!equal(first.retrieved,expected)) return false;
      if (!first.retrieved.every(doc => documents.some(source => source.id === doc.id && source.text === doc.text) && finite(doc.score) && doc.score > 0)) return false;
      const context = first.retrieved.map(doc => '['+doc.id+'] '+doc.text).join('\n');
      return equal(last.citations,first.retrieved.map(doc=>doc.id)) && last.context === context && last.answer === (first.retrieved.length ? context : '资料不足，暂不回答。') && equal(out.citations,last.citations) && out.context === context && out.answer === last.answer;
    }
    case 'memory': {
      if (typeof first.serialized !== 'string' || !records(input.operations) || !input.operations.length || typeof input.preserveCompletedIds !== 'boolean' || b.input.serialized !== first.serialized) return false;
      let state: unknown;
      try { state = JSON.parse(first.serialized); } catch { return false; }
      if (!isRecord(state) || !finite(state.balance) || !strings(state.completedIds) || !equal(first.balance,state.balance) || !equal(first.completedIds,state.completedIds)) return false;
      let balance = state.balance;
      const completedIds = input.preserveCompletedIds ? [...state.completedIds] : [];
      const executedIds: string[] = [], skippedIds: string[] = [];
      for (const operation of input.operations) {
        if (typeof operation.id !== 'string' || !finite(operation.amount)) return false;
        if (completedIds.includes(operation.id)) { skippedIds.push(operation.id); continue; }
        balance += operation.amount; completedIds.push(operation.id); executedIds.push(operation.id);
      }
      return equal(last,{balance,completedIds,executedIds,skippedIds}) && equal(out,last);
    }
    case 'mcp': {
      if (!isRecord(first.response) || !isRecord(first.response.result) || !records(first.response.result.tools) || !first.response.result.tools.length || first.executions !== 0 || a.input.method !== 'tools/list' || first.response.id !== a.input.id || b.input.method !== 'tools/call' || !isRecord(b.input.params) || !isRecord(b.input.params.arguments) || !isRecord(last.response)) return false;
      const params = b.input.params;
      if (!first.response.result.tools.some(tool=>tool.name === params.name && isRecord(tool.inputSchema))) return false;
      const response = last.response, args = b.input.params.arguments;
      if (response.id !== b.input.id || response.jsonrpc !== '2.0') return false;
      if (isRecord(response.error)) {
        const invalid = !finite(args.people) || !finite(args.price) || args.people<0 || args.price<0;
        if (last.executions !== 0 || !(input.allowCall === false || invalid) || !finite(response.error.code) || typeof response.error.message !== 'string') return false;
      } else {
        if (input.allowCall !== true || !isRecord(response.result) || !records(response.result.content) || response.result.content.length !== 1 || typeof response.result.content[0].text !== 'string' || last.executions !== 1 || !finite(args.people) || !finite(args.price)) return false;
        let result: unknown; try { result = JSON.parse(response.result.content[0].text); } catch { return false; }
        if (!isRecord(result) || !close(result.total,args.people*args.price)) return false;
      }
      return equal(out.response,response) && out.executions === last.executions;
    }
    case 'evaluation': {
      if (!records(first.rows) || !first.rows.length || !records(last.scored) || last.scored.length !== first.rows.length || !finite(input.tolerance) || input.tolerance < 0 || !equal(b.input.rows,first.rows)) return false;
      const tolerance = input.tolerance;
      let passed = 0; const failures: unknown[] = [];
      for (let index=0; index<first.rows.length; index++) {
        const row = first.rows[index], scored = last.scored[index];
        if (!finite(row.actual) || !finite(row.expected)) return false;
        const error = Math.abs(row.actual-row.expected), accepted = error<=tolerance;
        if (scored.id !== row.id || !close(scored.absoluteError,error) || scored.passed !== accepted || !equal(scored.actual,row.actual) || !equal(scored.expected,row.expected)) return false;
        if (accepted) passed++; else failures.push(row.id);
      }
      return last.total === first.rows.length && last.passed === passed && close(last.successRate,passed/first.rows.length) && equal(last.failures,failures) && equal(out,last);
    }
    case 'multi-agent': {
      if (!isRecord(first.packet) || !isRecord(last.review) || !isRecord(input.task) || !records(input.sources) || !strings(first.packet.sourceIds) || !finite(first.packet.total) || !finite(input.task.people) || !finite(input.task.price) || !equal(b.input.packet,first.packet)) return false;
      const packet = first.packet, review = last.review, sources = input.sources;
      const sourceIds = packet.sourceIds as string[];
      const issues: string[] = [];
      if (!sourceIds.length || sourceIds.some(id=>!sources.some(source=>source.id===id))) issues.push('缺少有效来源');
      if (packet.total !== input.task.people*input.task.price) issues.push('金额不一致');
      return packet.role === 'researcher' && review.role === 'reviewer' && equal(review.issues,issues) && review.accepted === !issues.length && review.total === packet.total && equal(review.sourceIds,packet.sourceIds) && equal(out.packet,packet) && equal(out.review,review) && out.status === (issues.length?'退回补充':'可交付');
    }
    case 'capstone': {
      if (!isRecord(first.source) || !isRecord(first.calculation) || !isRecord(last.report) || !records(input.documents) || !finite(input.people) || !finite(input.budget) || !finite(first.source.unitPrice) || !equal(b.input.source,first.source) || !equal(b.input.calculation,first.calculation)) return false;
      const source = first.source, calculation = first.calculation, report = last.report;
      if (!input.documents.some(doc=>equal(doc,source)) || !close(calculation.total,input.people*Number(source.unitPrice))) return false;
      const checks = {sourceExists:true,arithmeticCorrect:true,withinBudget:Number(calculation.total)<=input.budget};
      return equal(report.checks,checks) && report.approved === checks.withinBudget && equal(report.citations,[source.id]) && report.quote === source.text && report.total === calculation.total && report.budget === input.budget && equal(out,report);
    }
    default: return false;
  }
}

function validateAdvancedRun(id: string, events: RunEvent[], result: RunResult): LessonValidation {
  const lab = getAdvancedLab(id)!;
  const output = events.filter(event => event.type === 'output' && event.nodeId === 'output').at(-1);
  if (!output || !isRecord(output.data) || !hasContent(output.data) || !equal(result.output,output.data)) return notYet('还缺少本章实际的最终结果。请运行完整代码，并用 lab.output(...) 展示本次结果。');
  const steps = lab.nodes.slice(0,-1).map(node => events.filter(event => event.type === 'step' && event.nodeId === node.id).at(-1));
  const missing = steps.findIndex(event => !event);
  if (missing >= 0) return notYet(`还没有观察到“${lab.nodes[missing].title}”。请保留对应 lab.step 记录，执行本章的实际计算。`);
  const [input, first, second] = steps as RunEvent[];
  if (!(input.seq < first.seq && first.seq < second.seq && second.seq < output.seq)) return notYet('本章的输入、中间步骤和输出顺序没有连起来。请先计算，再记录和展示结果。');
  if (!isRecord(input.data) || !isStepEvidence(first.data) || !isStepEvidence(second.data)) return notYet('中间步骤还没有记录实际 input 与 result。请检查节点数据，而不只是打印一段文字。');
  try {
    if (!advancedEvidenceMatches(id,input.data,first.data,second.data,output.data)) return notYet('中间计算、状态传递或最终输出还对不上。请逐步核对实际输入与结果，再重新运行。');
  } catch { return notYet('执行记录的数据不完整，尚不能验证本章流程。请重新运行完整实验。'); }
  return { passed:true, reason:'本章的输入、关键计算或状态交接与最终结果已核对。改变一个参数，再比较两次证据；跑通流程不等于掌握全部原理。' };
}

/** Checks observed execution evidence, not source text or a zero exit code.
 * This is a learning checkpoint, not an anti-cheating or security boundary. */
export function validateLessonRun(lessonId: string, result: RunResult | null): LessonValidation {
  if (!result) return notYet('先运行一次实验，让代码留下可观察的执行过程。');
  if (result.status === 'cancelled') return notYet('这次运行已停止。让实验完整结束后，再来点亮这一章。');
  if (result.status === 'failed') return notYet('这次运行还没有成功。先查看错误节点，修改后再试一次。');
  if (!['first-call', 'context', 'tools', 'agent-loop'].includes(lessonId) && !getAdvancedLab(lessonId)) {
    return notYet('这一章目前开放原理预览，完整实验还在准备中。');
  }
  const events = ordered(result.events);
  const terminal = events.filter(event => ['run.completed', 'run.failed', 'run.cancelled'].includes(event.type)).at(-1);
  if (terminal?.type === 'run.failed') return notYet('执行记录显示运行失败，请先修复错误再试。');
  if (terminal?.type === 'run.cancelled') return notYet('执行记录显示运行已停止，请完成一次完整实验。');
  if (getAdvancedLab(lessonId)) return validateAdvancedRun(lessonId,events,result);
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
      if (!['input','model','tool'].includes(nodeId) && event.type === 'step' && isStepEvidence(event.data)) state = 'completed';
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
