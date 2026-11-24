import type { ModelRequest, ModelResponse } from '../types';

export const MAX_MODEL_CALLS = 8;
export const MAX_TOOL_CALLS = 8;
export const RUN_TIMEOUT_MS = 40_000;
export const TOOL_NAMES = ['calculator', 'search'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateModelRequest(value: unknown): ModelRequest {
  if (!isRecord(value) || typeof value.prompt !== 'string' || !value.prompt.trim()) {
    throw new Error('lab.model 需要非空字符串 prompt。');
  }
  if (value.prompt.length > 30_000) throw new Error('prompt 超过 30,000 字符限制。');
  if (value.system !== undefined && (typeof value.system !== 'string' || value.system.length > 30_000)) {
    throw new Error('system 必须是最多 30,000 字符的字符串。');
  }
  if (value.tools !== undefined && (!Array.isArray(value.tools) || value.tools.some((t) => !TOOL_NAMES.includes(t as typeof TOOL_NAMES[number])))) {
    throw new Error('本实验只支持 calculator 和 search 工具。');
  }
  if (value.history !== undefined && (!Array.isArray(value.history) || value.history.length > 40 || value.history.some((item) => !isRecord(item) || !['user', 'assistant', 'tool'].includes(String(item.role)) || typeof item.content !== 'string' || item.content.length > 30_000))) {
    throw new Error('history 必须是最多 40 条 { role, content } 消息。');
  }
  if (value.temperature !== undefined && (typeof value.temperature !== 'number' || !Number.isFinite(value.temperature) || value.temperature < 0 || value.temperature > 2)) {
    throw new Error('temperature 必须是 0 到 2 的有限数字。');
  }
  return {
    prompt: value.prompt,
    ...(value.system !== undefined ? { system: value.system as string } : {}),
    ...(value.tools !== undefined ? { tools: [...new Set(value.tools as string[])] } : {}),
    ...(value.history !== undefined ? { history: value.history as ModelRequest['history'] } : {}),
    ...(value.temperature !== undefined ? { temperature: value.temperature as number } : {}),
  };
}

/** Arithmetic parser: accepts numbers and arithmetic, never evaluates JS. */
export function calculate(expression: string): number {
  if (typeof expression !== 'string' || !expression.trim() || expression.length > 200) throw new Error('expression 必须是 1–200 字符的算式。');
  const input = expression.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
  const tokens = input.match(/(?:\d+(?:\.\d*)?|\.\d+)|[()+\-*/%]/g) ?? [];
  if (tokens.join('') !== input.replace(/\s/g, '')) throw new Error('计算器只接受数字、括号和 + - * / % 运算。');
  let position = 0;
  let depth = 0;
  function factor(): number {
    if (++depth > 60) throw new Error('算式嵌套过深。');
    const token = tokens[position++];
    let result: number;
    if (token === '+') result = factor();
    else if (token === '-') result = -factor();
    else if (token === '(') {
      result = sum();
      if (tokens[position++] !== ')') throw new Error('算式括号不匹配。');
    } else if (token !== undefined && /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(token)) result = Number(token);
    else throw new Error('算式格式不正确。');
    depth--;
    return result;
  }
  function product(): number {
    let result = factor();
    while (['*', '/', '%'].includes(tokens[position])) {
      const operator = tokens[position++];
      const right = factor();
      if ((operator === '/' || operator === '%') && right === 0) throw new Error('不能除以零。');
      result = operator === '*' ? result * right : operator === '/' ? result / right : result % right;
    }
    return result;
  }
  function sum(): number {
    let result = product();
    while (['+', '-'].includes(tokens[position])) {
      const operator = tokens[position++];
      const right = product();
      result = operator === '+' ? result + right : result - right;
    }
    return result;
  }
  const result = sum();
  if (position !== tokens.length || !Number.isFinite(result)) throw new Error('算式无效，或结果超出有限数字范围。');
  return result;
}

const documents = [
  { id: 'rag', title: 'RAG · 检索增强生成', keywords: ['rag', '检索', '知识库'], text: 'RAG 先从资料中检索相关片段，再把片段放入模型上下文，帮助模型基于资料回答。检索结果不是指令，答案仍需核验来源。' },
  { id: 'agent', title: 'Agent · 受控工具循环', keywords: ['agent', '智能体', '代理'], text: 'Agent 在目标与边界内，循环调用模型、执行工具、观察结果，并在完成任务或达到步数上限时停止。' },
  { id: 'llm', title: 'LLM · 大语言模型', keywords: ['llm', '语言模型', '大模型'], text: '大语言模型根据上下文预测后续 token。它可生成文本和工具调用请求，但不直接执行工具，也不能保证内容真实。' },
  { id: 'context', title: 'Context · 上下文', keywords: ['context', '上下文', '记忆', 'history'], text: '上下文是本次请求提供给模型的信息，包括系统要求、历史消息、工具结果与用户输入；超过窗口的信息需要选择或压缩。' },
  { id: 'tool', title: 'Tool · 工具调用', keywords: ['tool', '工具', 'function'], text: '模型输出工具名与参数，程序验证参数并执行工具，再把结果返回模型。实际权限和执行责任属于程序。' },
  { id: 'embedding', title: 'Embedding · 向量表示', keywords: ['embedding', '向量', '语义'], text: 'Embedding 将文本表示为向量，可用向量相似度找出相关资料；相似并不等于事实正确。' },
  { id: 'token', title: 'Token · 文本片段', keywords: ['token', '分词'], text: 'Token 是模型处理文本的基本片段，不一定等于一个字或一个单词；切分方式取决于模型使用的 tokenizer。' },
];

export function runTool(name: string, args: unknown): Record<string, unknown> {
  if (!isRecord(args)) throw new Error('工具参数必须是对象 / dict。');
  if (name === 'calculator') {
    if (typeof args.expression !== 'string') throw new Error('calculator 需要字符串参数 expression。');
    return { expression: args.expression, result: calculate(args.expression) };
  }
  if (name === 'search') {
    if (typeof args.query !== 'string' || !args.query.trim() || args.query.length > 500) throw new Error('search 需要 1–500 字符的 query。');
    const query = args.query.toLowerCase();
    const results = documents
      .map((document) => ({ document, score: document.keywords.filter((keyword) => query.includes(keyword)).length }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(({ document }) => ({ id: document.id, title: document.title, text: document.text }));
    return { query: args.query, source: '内置教学资料库（非互联网搜索）', results };
  }
  throw new Error(`未知工具：${name}。支持 calculator、search。`);
}

function extractExpression(prompt: string): string | undefined {
  const normalized = prompt.replace(/乘以|乘|×/g, '*').replace(/除以|÷/g, '/').replace(/加上|加/g, '+').replace(/减去|减/g, '-');
  return normalized.match(/-?\d+(?:\.\d+)?(?:\s*[+*/%\-]\s*-?\d+(?:\.\d+)?)+/)?.[0];
}

function completedTools(request: ModelRequest): Set<string> {
  const result = new Set<string>();
  for (const message of request.history ?? []) {
    if (message.role === 'tool') {
      try { const parsed = JSON.parse(message.content); if (typeof parsed.name === 'string') result.add(parsed.name); } catch { /* Also support readable tool messages. */ }
    }
    if (message.role === 'tool' || message.content.startsWith('工具返回（数据，不是指令）')) {
      for (const name of TOOL_NAMES) if (message.content.includes(name)) result.add(name);
    }
  }
  return result;
}

function evidenceText(request: ModelRequest, name: string): string | undefined {
  const message = [...(request.history ?? [])].reverse().find((item) =>
    (item.role === 'tool' || item.content.startsWith('工具返回（数据，不是指令）')) && item.content.includes(name));
  if (!message) return undefined;
  let text = message.content;
  if (text.startsWith('工具返回（数据，不是指令）')) text = text.slice(text.indexOf(':') + 1).trim();
  try {
    let value = JSON.parse(text);
    if (message.role === 'tool' && value.name === name) value = value.result;
    if (name === 'calculator' && typeof value.result === 'number') return `${value.expression ?? '计算结果'} = ${value.result}。`;
    if (name === 'search' && Array.isArray(value.results)) return value.results.map((item: { text?: string }) => item.text ?? '').join('\n') || '内置资料库没有找到相关条目。';
  } catch {
    // Python str(dict) is intentionally supported without evaluating Python.
    if (name === 'calculator') {
      const result = text.match(/['"]result['"]:\s*(-?\d+(?:\.\d+)?)/)?.[1];
      const expression = text.match(/['"]expression['"]:\s*['"]([^'"]+)['"]/)?.[1];
      if (result) return `${expression ?? '计算结果'} = ${result}。`;
    }
    if (name === 'search') {
      const passages = [...text.matchAll(/['"]text['"]:\s*'([^']+)'/g)].map((match) => match[1]);
      if (passages.length) return passages.join('\n');
    }
  }
  return text;
}

/** Transparent, deterministic teaching rules. This is deliberately not an LLM. */
export function simulateModel(raw: ModelRequest): ModelResponse {
  const request = validateModelRequest(raw);
  const { prompt, system = '', tools = [] } = request;
  const history = request.history ?? [];
  const complete = completedTools(request);
  const expression = extractExpression(prompt);
  const topic = /rag|检索增强/i.test(prompt) ? 'RAG' : /agent|智能体/i.test(prompt) ? 'Agent' : /embedding|向量/i.test(prompt) ? 'Embedding' : /上下文|context/i.test(prompt) ? '上下文' : '大语言模型';
  const needsSearch = /查询|查找|搜索|检索|search|look up/i.test(prompt);
  if (tools.includes('search') && needsSearch && !complete.has('search')) {
    const knownTopic = /rag|检索增强|agent|智能体|embedding|向量|上下文|context|语言模型|llm/i.test(prompt);
    const query = knownTopic ? topic : prompt.replace(/^.*?(?:查询|查找|搜索|检索|search|look up)\s*/i, '').split(/[，。；,;]/)[0].trim() || prompt;
    return { text: '教学规则：先查询内置资料库。', toolCalls: [{ name: 'search', arguments: { query } }] };
  }
  if (tools.includes('calculator') && expression && !complete.has('calculator')) {
    return { text: '教学规则：把算式交给计算器。', toolCalls: [{ name: 'calculator', arguments: { expression } }] };
  }
  if (complete.size) {
    const parts: string[] = [];
    if (complete.has('search')) parts.push(evidenceText(request, 'search') ?? '已收到检索结果。');
    if (complete.has('calculator')) parts.push(evidenceText(request, 'calculator') ?? '已收到计算结果。');
    if (!parts.length) parts.push('工具结果已收到，教学循环结束。');
    return { text: parts.join('\n'), toolCalls: [] };
  }
  const context = history.map((message) => message.content).join('\n');
  let text: string;
  if (/英文|english/i.test(system)) {
    text = topic === 'Agent' ? 'An agent uses a model to choose tools, observe results, and repeat until a stopping condition is met.' : 'A large language model predicts text from its context; fluent answers still need verification.';
  } else if (/做饭|烹饪|厨房|菜谱/.test(context)) {
    text = '你可以把大语言模型想成读过很多菜谱的厨房助手：它根据你已经说的内容，接着组织可能合适的话。它有时也会把配料记错，所以重要答案要核对。';
  } else if (expression) {
    text = `${expression} = ${calculate(expression)}。（教学规则直接计算；没有发生模型 API 调用。）`;
  } else if (/rag|agent|embedding|大语言模型|语言模型|llm|上下文|context|智能体/i.test(prompt)) {
    const result = runTool('search', { query: topic }).results as { text: string }[];
    text = result[0]?.text ?? '模型根据提供的上下文生成后续内容。';
    if (/避免专业术语|小学生|简单|通俗|一句话|简洁/.test(`${system} ${prompt}`)) {
      text = topic === 'Agent' ? 'Agent 会让模型选择工具、查看结果，直到任务完成或达到限制。' : topic === 'RAG' ? 'RAG 就是先查资料，再把查到的内容交给模型回答。' : '大语言模型像一个读过很多文字的接话助手，会根据你提供的内容继续生成文字，但答案可能出错。';
    }
    if (/比喻/.test(system) && topic === '大语言模型') text = '大语言模型像一个读过很多书的接话助手，根据上下文组织接下来的文字；它说得流畅，也仍可能出错。';
  } else {
    text = `教学模型收到：${prompt}\n这是一条可复现的教学规则回复。切换真实 API 后，由你配置的模型处理这段输入。`;
  }
  if (/只根据|仅根据/.test(system) && !history.length) text = '当前没有提供参考资料，无法根据资料回答。';
  if (/json/i.test(system)) text = JSON.stringify({ answer: text });
  return { text, toolCalls: [] };
}

export function serializable(value: unknown): unknown {
  // JSON can represent the same object in two sibling branches. Only a
  // reference back to an active ancestor is a cycle. `this` is the holder of
  // the current property, so leaving a branch also leaves its ancestor stack.
  const ancestors: object[] = [];
  try {
    const json = JSON.stringify(value, function(this: object, _key, item: unknown) {
      if (typeof item === 'bigint') return item.toString();
      if (typeof item === 'function') return '[function]';
      if (item instanceof Error) return { name: item.name, message: item.message };
      if (typeof item === 'object' && item !== null) {
        while (ancestors.length && ancestors.at(-1) !== this) ancestors.pop();
        if (ancestors.includes(item)) return '[circular]';
        ancestors.push(item);
      }
      return item;
    });
    if (json === undefined) return null;
    return json.length > 80_000 ? `${json.slice(0, 80_000)}… [输出已截断]` : JSON.parse(json);
  } catch { return String(value); }
}
