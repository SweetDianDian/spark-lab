import { useEffect, useRef, useState } from 'react';
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
import type { CodeLocation } from '../lib/execution-inspector';

self.MonacoEnvironment = { getWorker(_id, label) { return label === 'typescript' || label === 'javascript' ? new TsWorker() : new EditorWorker(); } };
loader.config({ monaco });
monaco.editor.defineTheme('spark', {
  base: 'vs', inherit: true,
  rules: [{ token: 'comment', foreground: '8A806D' }, { token: 'string', foreground: '9B4A34' }, { token: 'keyword', foreground: '254BE0' }, { token: 'number', foreground: 'A53E2E' }],
  colors: { 'editor.background': '#FFFAF0', 'editor.foreground': '#27251F', 'editorLineNumber.foreground': '#A29782', 'editorLineNumber.activeForeground': '#254BE0', 'editor.lineHighlightBackground': '#F3EDDE', 'editor.selectionBackground': '#DCE2FB', 'editorIndentGuide.background1': '#DED5C2', 'editorCursor.foreground': '#C64D36', 'editorWidget.background': '#F6EFDF' },
});
monaco.languages.typescript.typescriptDefaults.addExtraLib(`declare const lab: { model(request: {prompt:string,system?:string,tools?:string[],history?:{role:string,content:string}[]}):Promise<{text:string,toolCalls:{name:string,arguments:Record<string,unknown>}[]}>; tool(name:string,args:Record<string,unknown>):Promise<any>; output(value:any):void; log(value:any):void; step(nodeId:string,title:string,data?:any):void; };`, 'lab.d.ts');
monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true });
monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true });

export default function CodeEditor({ code, language, onChange, location, revealKey, readOnly = false }: { code: string; language: Language; onChange: (value: string) => void; location?: CodeLocation | null; revealKey?: string; readOnly?: boolean }) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const decorations = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    decorations.current?.clear();
    if (!location) return;
    const model = editor.getModel();
    if (!model || location.startLine < 1 || location.endLine > model.getLineCount()) return;
    const range = new monaco.Range(location.startLine, 1, location.endLine, model.getLineMaxColumn(location.endLine));
    decorations.current = editor.createDecorationsCollection([{ range, options: { isWholeLine: true, className: location.kind === 'matched' ? 'code-active-line' : 'code-related-line', glyphMarginClassName: location.kind === 'matched' ? 'code-active-glyph' : 'code-related-glyph' } }]);
  }, [location?.startLine, location?.endLine, location?.kind, code, ready]);
  useEffect(() => {
    // Editing may move or invalidate an association, but must not pull the
    // learner's viewport away. Only step selections and new events reveal it.
    if (!revealKey) return;
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (editor && model && location && location.startLine >= 1 && location.endLine <= model.getLineCount()) {
      // Explicitly locating an edit should also put the typing caret at its value.
      if (revealKey.startsWith('edit:')) {
        const line = model.getLineContent(location.startLine);
        const assignment = /=\s*/.exec(line);
        editor.setPosition({ lineNumber: location.startLine, column: assignment ? assignment.index + assignment[0].length + 1 : 1 });
        editor.focus();
      } else if (revealKey.startsWith('frame:') && editor.hasTextFocus()) {
        return;
      }
      editor.revealLinesInCenter(location.startLine, location.endLine, monaco.editor.ScrollType.Immediate);
    }
  }, [revealKey, ready]);
  return <Editor height="100%" language={language} value={code} theme="spark" onChange={value => onChange(value ?? '')} onMount={editor => { editorRef.current = editor; setReady(true); }} loading={<div className="editor-loading"><Spin/><Typography.Text type="secondary">正在加载代码编辑器…</Typography.Text></div>} options={{ readOnly, minimap: { enabled: false }, fontSize: 15, lineHeight: 26, fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace", padding: { top: 16, bottom: 16 }, scrollBeyondLastLine: false, wordWrap: 'on', automaticLayout: true, overviewRulerLanes: 0, hideCursorInOverviewRuler: true, folding: false, lineNumbersMinChars: 3, glyphMargin: true, renderLineHighlight: 'line', tabSize: 2, scrollbar: { vertical: 'visible', horizontal: 'visible', verticalScrollbarSize: 12, horizontalScrollbarSize: 12, alwaysConsumeMouseWheel: true }, accessibilitySupport: 'on', ariaLabel: `${language} 实验代码编辑器` }}/>
}
