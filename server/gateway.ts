import type { ModelRequest, ModelResponse } from '../src/types';

type Env = Record<string, string | undefined>;
type GatewayOptions = { fetch?: typeof fetch; now?: () => number; timeoutMs?: number };
type Budget = { startedAt: number; count: number; active: number };

const PROVIDERS: Record<string, string> = {
  'https://api.openai.com/v1': 'OpenAI',
  'https://api.deepseek.com/v1': 'DeepSeek',
  'https://dashscope.aliyuncs.com/compatible-mode/v1': '通义千问',
};
const MAX_BODY_BYTES = 32_768;
const HOUR = 3_600_000;
const MAX_OUTPUT_TOKENS = 1_024;
const SESSION_REQUESTS = 30;
const TOTAL_REQUESTS = 120;
const SESSION_COOKIE = 'spark_api_session';

const toolDefinitions = {
  calculator: {
    type: 'function',
    function: {
      name: 'calculator',
      description: '计算一个只包含数字、空格、小数点、括号以及 + - * / 运算符的算术表达式。必须实际调用工具取得结果。',
      parameters: {
        type: 'object',
        properties: { expression: { type: 'string', description: '例如：17 * 23' } },
        required: ['expression'], additionalProperties: false,
      },
    },
  },
  search: {
    type: 'function',
    function: {
      name: 'search',
      description: '在本课程的教学资料中查找有关 RAG、Agent、工具调用、上下文、Embedding 的知识。不是互联网搜索。',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: '要查找的知识，例如 RAG' } },
        required: ['query'], additionalProperties: false,
      },
    },
  },
} as const;

class GatewayError extends Error {
  constructor(public status: number, message: string, public code: string) { super(message); }
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...extra,
    },
  });
}

function config(env: Env) {
  const baseUrl = (env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const provider = PROVIDERS[baseUrl];
  const model = env.AI_MODEL?.trim() || '';
  const key = env.AI_API_KEY?.trim() || '';
  const validModel = /^[a-zA-Z0-9_.:/-]{1,128}$/.test(model);
  return { baseUrl, provider, model, key, configured: !!provider && validModel && !!key };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateRequest(value: unknown): ModelRequest {
  if (!record(value)) throw new GatewayError(400, '请求需要是一个 JSON 对象。', 'invalid_request');
  const permitted = new Set(['prompt', 'system', 'tools', 'history', 'temperature']);
  if (Object.keys(value).some(key => !permitted.has(key))) {
    throw new GatewayError(400, '请求包含不支持的字段。模型与 API 地址由服务端配置。', 'invalid_request');
  }
  if (typeof value.prompt !== 'string' || !value.prompt.trim() || value.prompt.length > 8_000) {
    throw new GatewayError(400, '问题需要是 1 至 8000 个字符的文字。', 'invalid_prompt');
  }
  if (value.system !== undefined && (typeof value.system !== 'string' || value.system.length > 4_000)) {
    throw new GatewayError(400, '系统指令最多 4000 个字符。', 'invalid_system');
  }
  if (value.tools !== undefined && (!Array.isArray(value.tools) || value.tools.length > 2 ||
    value.tools.some(tool => typeof tool !== 'string' || !Object.hasOwn(toolDefinitions, tool)) ||
    new Set(value.tools).size !== value.tools.length)) {
    throw new GatewayError(400, '只支持 calculator 和 search 两个课程工具，且不能重复。', 'invalid_tools');
  }
  if (value.temperature !== undefined && (typeof value.temperature !== 'number' ||
    !Number.isFinite(value.temperature) || value.temperature < 0 || value.temperature > 2)) {
    throw new GatewayError(400, 'temperature 需要在 0 到 2 之间。', 'invalid_temperature');
  }
  let total = value.prompt.length + (typeof value.system === 'string' ? value.system.length : 0);
  if (value.history !== undefined) {
    if (!Array.isArray(value.history) || value.history.length > 16) {
      throw new GatewayError(400, '历史消息最多 16 条。', 'invalid_history');
    }
    for (const message of value.history) {
      if (!record(message) || !['user', 'assistant'].includes(String(message.role)) ||
        typeof message.content !== 'string' || message.content.length > 4_000 ||
        Object.keys(message).some(key => !['role', 'content'].includes(key))) {
        throw new GatewayError(400, '历史消息只支持 user / assistant 角色，每条最多 4000 个字符。', 'invalid_history');
      }
      total += message.content.length;
    }
  }
  if (total > 16_000) throw new GatewayError(400, '本次上下文超过实验的 16000 字符上限。', 'context_too_large');
  return value as ModelRequest;
}

async function readJson(request: Request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new GatewayError(415, '请使用 application/json 请求格式。', 'invalid_content_type');
  }
  const length = Number(request.headers.get('content-length'));
  if (length > MAX_BODY_BYTES) throw new GatewayError(413, '实验请求过大。', 'body_too_large');
  const reader = request.body?.getReader();
  if (!reader) throw new GatewayError(400, '请求内容为空。', 'empty_body');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new GatewayError(413, '实验请求过大。', 'body_too_large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)) as unknown; }
  catch { throw new GatewayError(400, '请求内容不是有效 JSON。', 'invalid_json'); }
}

function requireSameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  // A browser POST always carries Origin. Reject missing/null origins instead of
  // turning the configured key into an unauthenticated generic proxy.
  if (!origin || origin !== new URL(request.url).origin ||
    ['cross-site', 'none'].includes(request.headers.get('sec-fetch-site') || '')) {
    throw new GatewayError(403, '请从当前实验页面发起请求。', 'origin_rejected');
  }
}

function toUpstreamBody(input: ModelRequest, model: string, provider: string) {
  const messages: { role: string; content: string }[] = [];
  if (input.system) messages.push({ role: 'system', content: input.system });
  // The teaching API's history intentionally consists of text messages. Tool
  // results are explicit data messages, not incomplete native tool messages.
  messages.push({ role: 'user', content: input.prompt }, ...(input.history || []));
  return {
    model, messages, stream: false,
    ...(provider === 'OpenAI' ? { max_completion_tokens: MAX_OUTPUT_TOKENS } : { max_tokens: MAX_OUTPUT_TOKENS }),
    ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
    ...(input.tools?.length ? {
      tools: input.tools.map(name => toolDefinitions[name as keyof typeof toolDefinitions]),
      tool_choice: 'auto',
    } : {}),
  };
}

function parseUpstream(value: unknown, allowedTools: string[]): ModelResponse {
  if (!record(value) || !Array.isArray(value.choices) || !record(value.choices[0]) ||
    !record(value.choices[0].message)) {
    throw new GatewayError(502, '模型返回了无法识别的数据格式。', 'invalid_upstream');
  }
  const choice = value.choices[0];
  const message = choice.message as Record<string, unknown>;
  if (choice.finish_reason === 'length') {
    throw new GatewayError(502, '模型达到本次输出长度上限，请缩短问题后重试。', 'output_limit');
  }
  if (choice.finish_reason === 'content_filter' || typeof message.refusal === 'string') {
    throw new GatewayError(422, '模型没有完成这次回答，请调整问题后重试。', 'model_refusal');
  }
  const toolCalls: ModelResponse['toolCalls'] = [];
  if (message.tool_calls !== undefined) {
    if (!Array.isArray(message.tool_calls) || message.tool_calls.length > 8) {
      throw new GatewayError(502, '模型返回的工具调用数量不符合实验限制。', 'invalid_tool_calls');
    }
    for (const call of message.tool_calls) {
      if (!record(call) || call.type !== 'function' || !record(call.function) ||
        typeof call.function.name !== 'string' || !allowedTools.includes(call.function.name) ||
        typeof call.function.arguments !== 'string' || call.function.arguments.length > 8_000) {
        throw new GatewayError(502, '模型请求了未声明的工具或返回了无效参数。', 'invalid_tool_calls');
      }
      let args: unknown;
      try { args = JSON.parse(call.function.arguments); } catch { /* validated below */ }
      if (!record(args)) throw new GatewayError(502, '模型返回的工具参数不是有效 JSON 对象。', 'invalid_tool_arguments');
      const field = call.function.name === 'calculator' ? 'expression' : 'query';
      if (typeof args[field] !== 'string' || !args[field].trim() || args[field].length > 2_000 ||
        Object.keys(args).some(key => key !== field)) {
        throw new GatewayError(502, '模型返回的工具参数没有通过校验。', 'invalid_tool_arguments');
      }
      toolCalls.push({ name: call.function.name, arguments: args });
    }
  }
  const text = typeof message.content === 'string' ? message.content : '';
  if (!text && !toolCalls.length) throw new GatewayError(502, '模型没有返回文字或工具调用。', 'empty_upstream');
  const result: ModelResponse = { text, toolCalls };
  if (record(value.usage) && typeof value.usage.prompt_tokens === 'number' &&
    typeof value.usage.completion_tokens === 'number' &&
    Number.isFinite(value.usage.prompt_tokens) && Number.isFinite(value.usage.completion_tokens) &&
    value.usage.prompt_tokens >= 0 && value.usage.completion_tokens >= 0) {
    result.usage = { input: value.usage.prompt_tokens, output: value.usage.completion_tokens };
  }
  return result;
}

/** Constructing a gateway owns one process/isolate's request budgets. These are
 * abuse limits for the prototype, not durable multi-region billing controls. */
export function createGateway(options: GatewayOptions = {}) {
  const upstreamFetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const now = options.now ?? Date.now;
  const sessions = new Map<string, Budget>();
  let total: Budget = { startedAt: now(), count: 0, active: 0 };

  return async function handleApi(request: Request, env: Env): Promise<Response | null> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return null;
    let sessionCookie: string | undefined;
    let session: Budget | undefined;
    let admitted = false;
    try {
      const settings = config(env);
      if (url.pathname === '/api/status' && request.method === 'GET') {
        return json({
          configured: settings.configured,
          provider: settings.provider || '未支持的 API 地址',
          model: settings.model || null,
          message: settings.configured ? '服务端已配置。运行实验时会产生真实 API 请求。' : '先体验教学模拟；真实 API 需要在服务端配置 AI_API_KEY 和 AI_MODEL。',
          limits: { requestsPerSessionHour: SESSION_REQUESTS, outputTokensPerCall: MAX_OUTPUT_TOKENS },
        });
      }
      if (url.pathname !== '/api/model') return json({ error: '接口不存在。', code: 'not_found' }, 404);
      if (request.method !== 'POST') return json({ error: '请使用 POST。', code: 'method_not_allowed' }, 405, { allow: 'POST' });
      requireSameOrigin(request);
      const input = validateRequest(await readJson(request));
      if (!settings.configured) throw new GatewayError(503, '真实模型尚未配置。请先配置服务端 AI_API_KEY、AI_MODEL 和支持的 AI_BASE_URL，或切回教学模拟。', 'not_configured');
      if (request.signal.aborted) throw new GatewayError(499, '这次请求已取消。', 'cancelled');

      const time = now();
      if (time - total.startedAt >= HOUR) { total.startedAt = time; total.count = 0; }
      for (const [key, budget] of sessions) {
        if (time - budget.startedAt >= HOUR && budget.active === 0) sessions.delete(key);
      }
      // Sites supplies this identity after its private-site authentication. The
      // local adapter strips it so a browser cannot forge an identity there.
      const owner = request.headers.get('oai-authenticated-user-id');
      const existing = request.headers.get('cookie')?.split(';').map(x => x.trim())
        .find(x => x.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
      let identity = owner ? `owner:${owner}` : existing && sessions.has(`browser:${existing}`) ? `browser:${existing}` : '';
      if (!identity) {
        const id = crypto.randomUUID();
        identity = `browser:${id}`;
        sessionCookie = `${SESSION_COOKIE}=${id}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=3600${url.protocol === 'https:' ? '; Secure' : ''}`;
      }
      session = sessions.get(identity) || { startedAt: time, count: 0, active: 0 };
      if (time - session.startedAt >= HOUR) { session.startedAt = time; session.count = 0; }
      if (session.count >= SESSION_REQUESTS || total.count >= TOTAL_REQUESTS || session.active >= 2 || total.active >= 4) {
        throw new GatewayError(429, '已达到本小时实验请求额度或同时运行数量，请稍后再试。', 'rate_limited');
      }
      session.count++; session.active++; total.count++; total.active++;
      sessions.set(identity, session);
      admitted = true;

      const controller = new AbortController();
      let timedOut = false;
      const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs ?? 25_000);
      const cancel = () => controller.abort();
      request.signal.addEventListener('abort', cancel, { once: true });
      if (request.signal.aborted) controller.abort();
      try {
        const response = await upstreamFetch(`${settings.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { authorization: `Bearer ${settings.key}`, 'content-type': 'application/json' },
          body: JSON.stringify(toUpstreamBody(input, settings.model, settings.provider)),
          signal: controller.signal,
          redirect: 'error',
        });
        if (!response.ok) {
          await response.body?.cancel();
          if ([401, 403].includes(response.status)) throw new GatewayError(502, '模型服务拒绝了凭证或模型权限，请检查服务端配置。', 'provider_auth');
          if (response.status === 429) throw new GatewayError(429, '模型服务暂时限流或额度不足，请稍后再试。', 'provider_rate_limited');
          if (response.status === 400 || response.status === 404) throw new GatewayError(502, '模型服务不接受当前模型或请求参数，请检查模型配置与能力。', 'provider_request');
          throw new GatewayError(502, '模型服务暂时不可用，请稍后再试。', 'provider_unavailable');
        }
        // Bound the upstream body too; never return raw provider errors or headers.
        const reader = response.body?.getReader();
        if (!reader) throw new GatewayError(502, '模型服务返回了空响应。', 'empty_upstream');
        let raw = '';
        let bytes = 0;
        const decoder = new TextDecoder();
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 1_048_576) { await reader.cancel(); throw new GatewayError(502, '模型响应超过实验大小限制。', 'upstream_too_large'); }
          raw += decoder.decode(chunk.value, { stream: true });
        }
        raw += decoder.decode();
        let value: unknown;
        try { value = JSON.parse(raw); }
        catch { throw new GatewayError(502, '模型服务返回了无法解析的数据。', 'invalid_upstream'); }
        if (request.signal.aborted) throw new GatewayError(499, '这次请求已取消。', 'cancelled');
        const result = parseUpstream(value, input.tools || []);
        return json(result, 200, sessionCookie ? { 'set-cookie': sessionCookie } : {});
      } catch (error) {
        if (request.signal.aborted) throw new GatewayError(499, '这次请求已取消。', 'cancelled');
        if (timedOut) throw new GatewayError(504, '模型响应超时。请求已停止等待，请稍后重试。', 'timeout');
        if (error instanceof GatewayError) throw error;
        throw new GatewayError(502, '暂时无法连接模型服务，请检查网络或服务端配置。', 'network_error');
      } finally {
        clearTimeout(timeout);
        request.signal.removeEventListener('abort', cancel);
      }
    } catch (error) {
      const safe = error instanceof GatewayError ? error : new GatewayError(500, '实验请求暂时未能完成。', 'internal_error');
      return json({ error: safe.message, code: safe.code }, safe.status, {
        ...(sessionCookie ? { 'set-cookie': sessionCookie } : {}),
        ...(safe.status === 429 ? { 'retry-after': '60' } : {}),
      });
    } finally {
      if (admitted && session) { session.active--; total.active--; }
    }
  };
}

export const handleApi = createGateway();
