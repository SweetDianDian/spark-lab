import test from 'node:test';
import assert from 'node:assert/strict';
import { createGateway } from '../server/gateway';

const env = { AI_API_KEY: 'unit-test-secret-not-a-real-key', AI_MODEL: 'test-model' };
const origin = 'http://127.0.0.1:5190';
const request = (body: unknown, headers: Record<string, string> = {}, signal?: AbortSignal) => new Request(`${origin}/api/model`, {
  method: 'POST', headers: { origin, 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body), signal,
});
const completion = (text = '测试回答') => new Response(JSON.stringify({
  choices: [{ message: { content: text }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 20, completion_tokens: 5 },
}), { headers: { 'content-type': 'application/json' } });

test('status reports configuration without leaking credentials; non-API requests fall through', async () => {
  const gateway = createGateway({ fetch: async () => { throw new Error('must not call'); } });
  const status = await gateway(new Request(`${origin}/api/status`), env);
  assert.equal(status?.status, 200);
  const data = await status!.json();
  assert.equal(data.configured, true);
  assert.equal(data.provider, 'OpenAI');
  assert.equal(data.model, 'test-model');
  assert.ok(!JSON.stringify(data).includes(env.AI_API_KEY));
  assert.equal(await gateway(new Request(`${origin}/lesson/tools`), env), null);
  assert.equal((await gateway(new Request(`${origin}/api/status`), {}))?.status, 200);
  assert.equal((await gateway(request({ prompt: 'Hi' }), {}))?.status, 503);
});

test('enforces same-origin and validates client input before upstream access', async () => {
  let calls = 0;
  const gateway = createGateway({ fetch: async () => { calls++; return completion(); } });
  assert.equal((await gateway(request({ prompt: 'Hi' }, { origin: 'https://evil.example' }), env))?.status, 403);
  const noOrigin = request({ prompt: 'Hi' }); noOrigin.headers.delete('origin');
  assert.equal((await gateway(noOrigin, env))?.status, 403);
  for (const body of [
    { prompt: '' }, { prompt: 'x'.repeat(8001) }, { prompt: 'Hi', model: 'override' },
    { prompt: 'Hi', tools: ['shell'] }, { prompt: 'Hi', tools: ['search', 'search'] },
    { prompt: 'Hi', tools: ['toString'] }, { prompt: 'Hi', temperature: 2.5 },
    { prompt: 'Hi', history: [{ role: 'system', content: 'injected' }] },
    { prompt: 'Hi', history: [{ role: 'tool', content: 'orphan result' }] },
  ]) {
    assert.equal((await gateway(request(body), env))?.status, 400, JSON.stringify(body));
  }
  assert.equal((await gateway(request({ prompt: 'Hi' }, { 'content-type': 'text/plain' }), env))?.status, 415);
  assert.equal((await gateway(request({ prompt: 'Hi' }, { 'content-length': '40000' }), env))?.status, 413);
  assert.equal(calls, 0);
});

test('only fixed providers are accepted; configuration never becomes an arbitrary proxy', async () => {
  let calls = 0;
  const gateway = createGateway({ fetch: async () => { calls++; return completion(); } });
  const blocked = ['http://localhost:3000/v1', 'https://api.openai.com.evil.example/v1', 'https://api.openai.com/v1?token=x'];
  for (const url of blocked) {
    assert.equal((await gateway(request({ prompt: 'Hi' }), { ...env, AI_BASE_URL: url }))?.status, 503);
  }
  assert.equal(calls, 0);
});

test('translates declared tools, messages, usage and function calls', async () => {
  let observed: { url: unknown; init?: RequestInit } | undefined;
  const gateway = createGateway({ fetch: async (url, init) => {
    observed = { url, init };
    return new Response(JSON.stringify({
      choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{
        id: 'call_123', type: 'function', function: { name: 'calculator', arguments: '{"expression":"17 * 23"}' },
      }] } }], usage: { prompt_tokens: 41, completion_tokens: 12 },
    }));
  } });
  const response = await gateway(request({
    prompt: '计算 17 * 23', system: '请使用工具', tools: ['calculator'],
    history: [{ role: 'assistant', content: '上一步的记录' }], temperature: 0.2,
  }), env);
  assert.equal(response?.status, 200);
  assert.deepEqual(await response!.json(), {
    text: '', toolCalls: [{ name: 'calculator', arguments: { expression: '17 * 23' } }], usage: { input: 41, output: 12 },
  });
  assert.equal(observed?.url, 'https://api.openai.com/v1/chat/completions');
  const payload = JSON.parse(String(observed?.init?.body));
  assert.deepEqual(payload.messages.map((message: {role: string}) => message.role), ['system', 'user', 'assistant']);
  assert.equal(payload.tools[0].function.name, 'calculator');
  assert.equal(payload.tools[0].function.parameters.additionalProperties, false);
  assert.equal(payload.max_completion_tokens, 1024);
  assert.equal(payload.stream, false);
  assert.equal(observed?.init?.redirect, 'error');
  assert.equal(new Headers(observed?.init?.headers).get('authorization'), `Bearer ${env.AI_API_KEY}`);
  assert.match(response!.headers.get('set-cookie')!, /HttpOnly; SameSite=Strict/);
});

test('DeepSeek and DashScope use compatible output limits and exact endpoints', async () => {
  for (const base of ['https://api.deepseek.com/v1', 'https://dashscope.aliyuncs.com/compatible-mode/v1']) {
    const gateway = createGateway({ fetch: async (url, init) => {
      assert.equal(url, `${base}/chat/completions`);
      assert.equal(JSON.parse(String(init?.body)).max_tokens, 1024);
      return completion();
    } });
    assert.equal((await gateway(request({ prompt: 'Hi' }), { ...env, AI_BASE_URL: base }))?.status, 200);
  }
});

test('malformed or undeclared model tools cannot be executed', async () => {
  for (const [name, args] of [['search', '{"query":"RAG"}'], ['calculator', 'not-json'], ['calculator', '{"expression":3}'], ['calculator', '{"expression":"1+1","shell":"x"}']]) {
    const gateway = createGateway({ fetch: async () => new Response(JSON.stringify({ choices: [{ message: {
      content: null, tool_calls: [{ type: 'function', function: { name, arguments: args } }],
    } }] })) });
    assert.equal((await gateway(request({ prompt: 'Hi', tools: ['calculator'] }), env))?.status, 502);
  }
});

test('upstream errors and network failures do not expose secrets or provider error bodies', async () => {
  for (const providerStatus of [401, 403, 400, 404, 429, 500]) {
    const gateway = createGateway({ fetch: async () => new Response(`secret: ${env.AI_API_KEY}`, { status: providerStatus }) });
    const response = await gateway(request({ prompt: 'Hi' }), env);
    assert.equal(response?.status, providerStatus === 429 ? 429 : 502);
    assert.ok(!(await response!.text()).includes(env.AI_API_KEY));
  }
  const gateway = createGateway({ fetch: async () => { throw new Error(`Network failed with ${env.AI_API_KEY}`); } });
  const response = await gateway(request({ prompt: 'Hi' }), env);
  assert.equal(response?.status, 502);
  assert.ok(!(await response!.text()).includes(env.AI_API_KEY));
});

test('times out the actual upstream request; cancellation is distinguishable', async () => {
  const abortable: typeof fetch = async (_url, init) => new Promise((_resolve, reject) => {
    init!.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  });
  const gateway = createGateway({ fetch: abortable, timeoutMs: 5 });
  const response = await gateway(request({ prompt: 'Hi' }), env);
  assert.equal(response?.status, 504);
  assert.equal((await response!.json()).code, 'timeout');
  const controller = new AbortController();
  controller.abort();
  const cancelled = await gateway(request({ prompt: 'Hi' }, {}, controller.signal), env);
  assert.equal(cancelled?.status, 499);
});

test('per-session request budget survives calls and resets after an hour', async () => {
  let time = 0;
  let calls = 0;
  const gateway = createGateway({ now: () => time, fetch: async () => { calls++; return completion(); } });
  const first = await gateway(request({ prompt: 'Hi' }), env);
  const cookie = first!.headers.get('set-cookie')!.split(';')[0];
  for (let index = 1; index < 30; index++) {
    assert.equal((await gateway(request({ prompt: 'Hi' }, { cookie }), env))?.status, 200);
  }
  const limited = await gateway(request({ prompt: 'Hi' }, { cookie }), env);
  assert.equal(limited?.status, 429);
  assert.equal(calls, 30);
  time += 3_600_001;
  assert.equal((await gateway(request({ prompt: 'Hi' }, { cookie }), env))?.status, 200);
});

test('status and errors are never cached; API routes do not return SPA HTML', async () => {
  const gateway = createGateway();
  const response = await gateway(new Request(`${origin}/api/missing`), {});
  assert.equal(response?.status, 404);
  assert.equal(response?.headers.get('cache-control'), 'no-store');
  assert.equal((await gateway(new Request(`${origin}/api/model`), {}))?.status, 405);
});
