import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { gatewayPlugin } from './server/dev-plugin';

export default defineConfig({
  plugins: [react(), gatewayPlugin()],
  build: { outDir: 'dist/client', chunkSizeWarningLimit: 1600 },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['pyodide'] },
});
