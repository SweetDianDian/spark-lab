import { useEffect, useRef } from 'react';
import { Spin, Typography } from 'antd';
import Editor, { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import 'monaco-editor/esm/vs/language/typescript/monaco.contribution';
import 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution';
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution';
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import type { Language } from '../types';

self.MonacoEnvironment = { getWorker(_id, label) { return label === 'typescript' || label === 'javascript' ? new TsWorker() : new EditorWorker(); } };
loader.config({ monaco });
monaco.editor.defineTheme('spark', {
  base: 'vs', inherit: true,
  rules: [{ token: 'comment', foreground: '6A778B' }, { token: 'string', foreground: '885635' }, { token: 'keyword', foreground: '4361EE' }, { token: 'number', foreground: '6851A5' }],
  colors: { 'editor.background': '#FFFFFF', 'editor.foreground': '#253046', 'editorLineNumber.foreground': '#8793A5', 'editorLineNumber.activeForeground': '#4361EE', 'editor.lineHighlightBackground': '#F1F4FA', 'editor.selectionBackground': '#DCE5FF', 'editorIndentGuide.background1': '#E0E6EF', 'editorCursor.foreground': '#4361EE', 'editorWidget.background': '#F1F4FA' },
});
monaco.languages.typescript.typescriptDefaults.addExtraLib(`declare const lab: { model(request: {prompt:string,system?:string,tools?:string[],history?:{role:string,content:string}[]}):Promise<{text:string,toolCalls:{name:string,arguments:Record<string,unknown>}[]}>; tool(name:string,args:Record<string,unknown>):Promise<any>; output(value:any):void; log(value:any):void; step(nodeId:string,title:string,data?:any):void; };`, 'lab.d.ts');
monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true });
monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true });

export default function CodeEditor({ code, language, onChange, reveal, readOnly = false }: { code: string; language: Language; onChange: (value: string) => void; reveal?: string; readOnly?: boolean }) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const decorations = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (!reveal) { decorations.current?.clear(); return; }
    const model = editor.getModel();
    const found = model?.findMatches(reveal, false, false, false, null, false)?.[0];
    if (found) {
      editor.revealLineInCenter(found.range.startLineNumber);
      decorations.current?.clear();
      decorations.current = editor.createDecorationsCollection([{ range: found.range, options: { isWholeLine: true, className: 'code-active-line', glyphMarginClassName: 'code-active-glyph' } }]);
    }
  }, [reveal, code]);
  return <Editor height="100%" language={language} value={code} theme="spark" onChange={value => onChange(value ?? '')} onMount={editor => { editorRef.current = editor; }} loading={<div className="editor-loading"><Spin/><Typography.Text type="secondary">正在加载代码编辑器…</Typography.Text></div>} options={{ readOnly, minimap: { enabled: false }, fontSize: 15, lineHeight: 26, fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace", padding: { top: 16, bottom: 16 }, scrollBeyondLastLine: false, wordWrap: 'on', automaticLayout: true, overviewRulerLanes: 0, hideCursorInOverviewRuler: true, folding: false, lineNumbersMinChars: 3, glyphMargin: true, renderLineHighlight: 'line', tabSize: 2, scrollbar: { vertical: 'visible', horizontal: 'visible', verticalScrollbarSize: 12, horizontalScrollbarSize: 12, alwaysConsumeMouseWheel: true }, accessibilitySupport: 'on', ariaLabel: `${language} 实验代码编辑器` }}/>
}
