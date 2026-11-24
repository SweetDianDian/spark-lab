export type Language = 'typescript' | 'javascript' | 'python';
export type RunMode = 'demo' | 'live';
export type RunEvent = {
  id: string; seq: number; timestamp: number; type: string;
  nodeId: string; title: string; data: unknown;
  source: 'runtime' | 'teaching-simulation';
};
export type RunResult = { id: string; events: RunEvent[]; output: unknown; duration: number; status: 'completed' | 'failed' | 'cancelled'; error?: string };
export type ModelRequest = { prompt: string; system?: string; tools?: string[]; history?: { role: string; content: string }[]; temperature?: number };
export type ModelResponse = { text: string; toolCalls: { name: string; arguments: Record<string, unknown> }[]; usage?: { input: number; output: number } };
export type Lesson = {
  id: string; number: string; title: string; subtitle: string; question: string;
  description: string; duration: string; color: string; icon: string;
  available: boolean; track: 'start' | 'build' | 'deep';
  concept: { title: string; body: string }[];
  prediction: { question: string; options: string[]; correct: number; explanation: string };
  challenge: { title: string; description: string; hint: string };
  nodes: { id: string; title: string; subtitle: string; codeMatch: string }[];
  starter: Record<Language, string>;
  takeaway: string;
};
export type SavedRun = RunResult & { lessonId: string; code: string; language: Language; mode: RunMode; savedAt: number; title: string };
