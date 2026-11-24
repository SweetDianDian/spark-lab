import type { Language, ModelRequest, ModelResponse, RunEvent, RunMode } from '../types';

export type RuntimeEvent = Pick<RunEvent, 'type' | 'nodeId' | 'title' | 'data' | 'source'>;
export type WorkerRequest =
  | { kind: 'run'; code: string; language: Language; mode: RunMode; lessonId: string }
  | { kind: 'model.response'; requestId: number; response?: ModelResponse; error?: string };
export type WorkerResponse =
  | { kind: 'event'; event: RuntimeEvent }
  | { kind: 'model.request'; requestId: number; request: ModelRequest }
  | { kind: 'done'; output: unknown }
  | { kind: 'failed'; error: string };
