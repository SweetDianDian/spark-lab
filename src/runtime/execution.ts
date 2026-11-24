import ts from 'typescript';
import type { Language, ModelRequest, ModelResponse } from '../types';

export type LabAPI = {
  model: (request: ModelRequest) => Promise<ModelResponse>;
  tool: (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  log: (value: unknown) => void;
  step: (nodeId: string, title: string, data?: unknown) => void;
  output: (value: unknown) => void;
};

export function compileJavascript(code: string, language: Language): string {
  if (language !== 'typescript') return code;
  const result = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, sourceMap: false },
    fileName: 'experiment.ts', reportDiagnostics: true,
  });
  const error = result.diagnostics?.find((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  if (error) throw new Error(ts.flattenDiagnosticMessageText(error.messageText, '\n'));
  return result.outputText;
}

export async function executeJavascript(code: string, language: Language, lab: LabAPI): Promise<unknown> {
  const compiled = compileJavascript(code, language);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (...args: string[]) => (lab: LabAPI, console: unknown) => Promise<unknown>;
  let execute;
  try { execute = new AsyncFunction('lab', 'console', `"use strict";\n${compiled}\n//# sourceURL=experiment.${language === 'typescript' ? 'ts' : 'js'}`); }
  catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`代码语法错误：${detail}。支持顶层 await；JS/TS 实验暂不支持静态 import / export。`);
  }
  const log = (...args: unknown[]) => lab.log(args.length === 1 ? args[0] : args);
  return execute(lab, { log, info: log, warn: log, error: log, debug: log });
}
