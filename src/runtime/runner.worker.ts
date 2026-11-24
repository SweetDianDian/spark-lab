import type { ModelRequest, ModelResponse, RunMode } from '../types';
import { MAX_MODEL_CALLS, MAX_TOOL_CALLS, runTool, serializable, simulateModel, validateModelRequest } from './core';
import { executeJavascript } from './execution';
import type { LabAPI } from './execution';
import type { RuntimeEvent, WorkerRequest, WorkerResponse } from './protocol';

const scope = self as unknown as {
  postMessage: (message: WorkerResponse) => void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  location: Location;
};
const pendingModels = new Map<number, { resolve: (value: ModelResponse) => void; reject: (error: Error) => void }>();
let requestId = 0;
let running = false;

function requestLiveModel(request: ModelRequest): Promise<ModelResponse> {
  return new Promise((resolve, reject) => {
    const id = ++requestId;
    pendingModels.set(id, { resolve, reject });
    scope.postMessage({ kind: 'model.request', requestId: id, request });
  });
}

function createLab(mode: RunMode): { lab: LabAPI; getOutput: () => unknown; hasOutput: () => boolean } {
  let models = 0;
  let tools = 0;
  let eventCount = 0;
  let output: unknown = null;
  let outputSet = false;
  const emit = (event: RuntimeEvent) => {
    if (++eventCount > 1000) throw new Error('本次运行超过 1,000 条事件，请减少循环或日志。');
    scope.postMessage({ kind: 'event', event: { ...event, data: serializable(event.data) } });
  };
  const source = mode === 'demo' ? 'teaching-simulation' : 'runtime';
  const lab: LabAPI = {
    async model(raw) {
      if (++models > MAX_MODEL_CALLS) throw new Error(`本次运行最多调用模型 ${MAX_MODEL_CALLS} 次，循环已停止。`);
      const request = validateModelRequest(raw);
      emit({ type: 'model.started', nodeId: 'model', title: `模型调用 · 第 ${models} 次`, data: request, source });
      try {
        const response = mode === 'demo' ? simulateModel(request) : await requestLiveModel(request);
        emit({ type: 'model.completed', nodeId: 'model', title: mode === 'demo' ? '教学规则返回' : '模型已返回', data: response, source });
        return response;
      } catch (error) {
        emit({ type: 'model.failed', nodeId: 'model', title: '模型调用失败', data: { error: error instanceof Error ? error.message : String(error) }, source });
        throw error;
      }
    },
    async tool(name, args) {
      if (++tools > MAX_TOOL_CALLS) throw new Error(`本次运行最多调用工具 ${MAX_TOOL_CALLS} 次，循环已停止。`);
      emit({ type: 'tool.started', nodeId: 'tool', title: `执行 ${name} · 第 ${tools} 次`, data: { name, arguments: args }, source: 'runtime' });
      try {
        const result = runTool(name, args);
        emit({ type: 'tool.completed', nodeId: 'tool', title: name === 'search' ? '内置资料库检索完成' : '计算器执行完成', data: { name, result }, source: 'runtime' });
        return result;
      } catch (error) {
        emit({ type: 'tool.failed', nodeId: 'tool', title: `${name} 执行失败`, data: { error: error instanceof Error ? error.message : String(error) }, source: 'runtime' });
        throw error;
      }
    },
    log(value) { emit({ type: 'log', nodeId: 'input', title: '代码日志', data: value, source: 'runtime' }); },
    step(nodeId, title, data = null) {
      if (!['input', 'model', 'tool', 'output'].includes(nodeId)) throw new Error('lab.step 的 nodeId 只支持 input / model / tool / output。');
      emit({ type: 'step', nodeId, title: String(title), data, source: 'runtime' });
    },
    output(value) {
      outputSet = true;
      output = serializable(value);
      emit({ type: 'output', nodeId: 'output', title: '最终输出', data: output, source: 'runtime' });
    },
  };
  return { lab, getOutput: () => output, hasOutput: () => outputSet };
}

async function executePython(code: string, lab: LabAPI): Promise<unknown> {
  // Assets are copied from the installed pyodide package into public/pyodide.
  // This keeps runtime loading local and never pulls Python code from a CDN.
  const moduleURL = new URL('/pyodide/pyodide.mjs', scope.location.href).href;
  const { loadPyodide } = await import(/* @vite-ignore */ moduleURL);
  const pyodide = await loadPyodide({
    indexURL: new URL('/pyodide/', scope.location.href).href,
    stdout: (value: string) => lab.log(value), stderr: (value: string) => lab.log(value),
  });
  pyodide.registerJsModule('_spark_bridge', {
    invoke: async (method: string, payload: string) => {
      const args = JSON.parse(payload);
      const result = method === 'model' ? await lab.model(args[0]) : method === 'tool' ? await lab.tool(args[0], args[1]) : undefined;
      return JSON.stringify(serializable(result));
    },
    emit: (method: string, payload: string) => {
      const args = JSON.parse(payload);
      if (method === 'log') lab.log(args[0]);
      else if (method === 'output') lab.output(args[0]);
      else if (method === 'step') lab.step(args[0], args[1], args[2]);
    },
  });
  await pyodide.runPythonAsync(`
import json as _spark_json
from _spark_bridge import invoke as _spark_invoke, emit as _spark_emit

class _SparkLab:
    async def model(self, request):
        return _spark_json.loads(await _spark_invoke("model", _spark_json.dumps([request], ensure_ascii=False)))
    async def tool(self, name, arguments):
        return _spark_json.loads(await _spark_invoke("tool", _spark_json.dumps([name, arguments], ensure_ascii=False)))
    def log(self, value):
        _spark_emit("log", _spark_json.dumps([value], ensure_ascii=False, default=str))
    def step(self, node_id, title, data=None):
        _spark_emit("step", _spark_json.dumps([node_id, title, data], ensure_ascii=False, default=str))
    def output(self, value):
        _spark_emit("output", _spark_json.dumps([value], ensure_ascii=False, default=str))

lab = _SparkLab()
`);
  const result = await pyodide.runPythonAsync(code);
  try {
    return result && typeof result.toJs === 'function' ? result.toJs({ dict_converter: Object.fromEntries }) : result;
  } finally {
    if (result && typeof result.destroy === 'function') result.destroy();
  }
}

scope.onmessage = (event) => {
  const message = event.data;
  if (message.kind === 'model.response') {
    const pending = pendingModels.get(message.requestId);
    if (!pending) return;
    pendingModels.delete(message.requestId);
    if (message.error) pending.reject(new Error(message.error));
    else if (message.response) pending.resolve(message.response);
    else pending.reject(new Error('模型返回了空响应。'));
    return;
  }
  if (message.kind !== 'run' || running) return;
  running = true;
  const session = createLab(message.mode);
  void (async () => {
    try {
      const returned = message.language === 'python'
        ? await executePython(message.code, session.lab)
        : await executeJavascript(message.code, message.language, session.lab);
      scope.postMessage({ kind: 'done', output: session.hasOutput() ? session.getOutput() : serializable(returned) });
    } catch (error) {
      scope.postMessage({ kind: 'failed', error: error instanceof Error ? error.message : String(error) });
    } finally {
      pendingModels.clear();
    }
  })();
};
