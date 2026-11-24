import { handleApi } from './gateway';

type WorkerEnv = {
  AI_API_KEY?: string;
  AI_BASE_URL?: string;
  AI_MODEL?: string;
  ASSETS: { fetch(request: Request): Promise<Response> };
};

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const api = await handleApi(request, {
      AI_API_KEY: env.AI_API_KEY,
      AI_BASE_URL: env.AI_BASE_URL,
      AI_MODEL: env.AI_MODEL,
    });
    if (api) return api;
    const asset = await env.ASSETS.fetch(request);
    const url = new URL(request.url);
    if (asset.status === 404 && request.method === 'GET' && request.headers.get('accept')?.includes('text/html') && !url.pathname.split('/').at(-1)?.includes('.')) {
      return env.ASSETS.fetch(new Request(new URL('/index.html', request.url), request));
    }
    return asset;
  },
};
