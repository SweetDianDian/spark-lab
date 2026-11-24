import { cp, mkdir } from 'node:fs/promises';
await mkdir('public/pyodide', { recursive: true });
for (const name of ['pyodide.asm.js', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json', 'pyodide.mjs']) {
  await cp(`node_modules/pyodide/${name}`, `public/pyodide/${name}`);
}
