import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadEnv } from 'vite';
import type { Plugin } from 'vite';
import { handleApi } from './gateway';

export function gatewayPlugin(): Plugin {
  let env: Record<string, string | undefined> = {};
  const middleware = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith('/api/')) { next(); return; }
    try {
      const host = req.headers.host || '';
      // The development gateway is loopback-only. Do not trust arbitrary Host or
      // forwarded identity headers when the dev server is exposed accidentally.
      if (!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host)) {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: '本地模型网关只接受本机访问。', code: 'host_rejected' }));
        return;
      }
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (name.startsWith('oai-') || name.startsWith('x-forwarded-') || value === undefined) continue;
        if (Array.isArray(value)) value.forEach(item => headers.append(name, item));
        else headers.set(name, value);
      }
      const controller = new AbortController();
      const abort = () => { if (!res.writableEnded) controller.abort(); };
      res.once('close', abort);
      const chunks: Buffer[] = [];
      let bytes = 0;
      if (!['GET', 'HEAD'].includes(req.method || 'GET')) {
        for await (const chunk of req) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          bytes += buffer.byteLength;
          if (bytes > 32_768) {
            res.writeHead(413, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: '实验请求过大。', code: 'body_too_large' }));
            return;
          }
          chunks.push(buffer);
        }
      }
      const request = new Request(`http://${host}${req.url}`, {
        method: req.method,
        headers,
        signal: controller.signal,
        ...(!['GET', 'HEAD'].includes(req.method || 'GET') ? { body: Buffer.concat(chunks) } : {}),
      });
      const response = await handleApi(request, env);
      if (!response) { next(); return; }
      if (res.destroyed) return;
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => { responseHeaders[key] = value; });
      res.writeHead(response.status, responseHeaders);
      res.end(Buffer.from(await response.arrayBuffer()));
      res.removeListener('close', abort);
    } catch {
      if (!res.headersSent && !res.destroyed) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: '本地网关暂时不可用。', code: 'gateway_error' }));
      }
    }
  };
  return {
    name: 'spark-model-gateway',
    configResolved(config) { env = loadEnv(config.mode, config.envDir, 'AI_'); },
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); },
  };
}
