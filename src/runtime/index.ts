import type { Language, ModelResponse, RunEvent, RunMode, RunResult } from '../types';
import { RUN_TIMEOUT_MS, serializable } from './core';
import type { RuntimeEvent, WorkerRequest, WorkerResponse } from './protocol';

export type RunOptions = {
  code: string;
  language: Language;
  mode: RunMode;
  lessonId: string;
  signal?: AbortSignal;
  onEvent?: (event: RunEvent) => void;
};

function isModelResponse(value: unknown): value is ModelResponse {
  if (!value || typeof value !== 'object') return false;
  const response = value as ModelResponse;
  return typeof response.text === 'string' && Array.isArray(response.toolCalls) && response.toolCalls.every((call) => call && typeof call.name === 'string' && call.arguments && typeof call.arguments === 'object' && !Array.isArray(call.arguments));
}

/** Each run owns a fresh, terminable worker. Workers are not a server sandbox. */
export function runCode(options: RunOptions): Promise<RunResult> {
  const id = globalThis.crypto?.randomUUID?.() ?? `run-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const started = performance.now();
  const events: RunEvent[] = [];
  const network = new AbortController();
  let worker: Worker | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finished = false;
  let output: unknown = null;
  let modelRequests = 0;
  return new Promise((resolve) => {
    const emit = (event: RuntimeEvent) => {
      if (finished) return;
      const seq = events.length + 1;
      const recorded = { ...event, data: serializable(event.data), id: `${id}:${seq}`, seq, timestamp: Date.now() };
      events.push(recorded);
      try { options.onEvent?.(recorded); } catch { /* UI callbacks must not strand a running worker. */ }
    };
    const finish = (status: RunResult['status'], error?: string) => {
      if (finished) return;
      emit({ type: `run.${status}`, nodeId: 'output', title: status === 'completed' ? '运行完成' : status === 'cancelled' ? '运行已停止' : '运行失败', data: error ? { error } : { output }, source: 'runtime' });
      finished = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      network.abort();
      if (worker) {
        worker.onmessage = null;
        worker.onerror = null;
        worker.onmessageerror = null;
        worker.terminate();
      }
      resolve({ id, events, output, duration: performance.now() - started, status, ...(error ? { error } : {}) });
    };
    const onAbort = () => finish('cancelled', '用户停止了本次运行。');
    if (options.signal?.aborted) { onAbort(); return; }
    options.signal?.addEventListener('abort', onAbort, { once: true });
    emit({ type: 'run.started', nodeId: 'input', title: '开始运行代码', data: { language: options.language, mode: options.mode, lessonId: options.lessonId }, source: 'runtime' });
    if (finished) return;
    if (!options.code.trim()) { finish('failed', '请先输入代码。'); return; }
    if (options.code.length > 100_000) { finish('failed', '代码超过 100,000 字符限制。'); return; }
    if (!['javascript', 'typescript', 'python'].includes(options.language)) { finish('failed', '不支持的编程语言。'); return; }
    try {
      worker = new Worker(new URL('./runner.worker.ts', import.meta.url), { type: 'module' });
      timer = setTimeout(() => finish('failed', '运行超过 40 秒，已终止代码执行。'), RUN_TIMEOUT_MS);
      worker.onerror = (event) => { event.preventDefault(); finish('failed', event.message || '代码运行环境启动失败。'); };
      worker.onmessageerror = () => finish('failed', '无法读取代码运行环境返回的数据。');
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        if (finished) return;
        const message = event.data;
        if (message.kind === 'event') {
          if (events.length > 1010) { finish('failed', '运行事件过多，已停止。'); return; }
          if (message.event.type === 'output') output = message.event.data;
          emit(message.event);
        } else if (message.kind === 'done') {
          output = message.output;
          finish('completed');
        } else if (message.kind === 'failed') {
          finish('failed', message.error);
        } else if (message.kind === 'model.request') {
          // Also enforce the request cap on the host side, independent of user code.
          if (options.mode !== 'live' || ++modelRequests > 8) { finish('failed', '模型请求超出本次运行允许的范围。'); return; }
          void (async () => {
            try {
              const response = await fetch('/api/model', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(message.request), signal: network.signal,
              });
              const body = await response.json().catch(() => null);
              if (!response.ok) throw new Error(body?.error?.message ?? body?.error ?? `模型请求失败（${response.status}）。`);
              if (!isModelResponse(body)) throw new Error('模型网关返回的数据格式不正确。');
              if (!finished) worker?.postMessage({ kind: 'model.response', requestId: message.requestId, response: body } satisfies WorkerRequest);
            } catch (error) {
              if (!finished) worker?.postMessage({ kind: 'model.response', requestId: message.requestId, error: error instanceof Error ? error.message : String(error) } satisfies WorkerRequest);
            }
          })();
        }
      };
      worker.postMessage({ kind: 'run', code: options.code, language: options.language, mode: options.mode, lessonId: options.lessonId } satisfies WorkerRequest);
    } catch (error) { finish('failed', error instanceof Error ? error.message : String(error)); }
  });
}
