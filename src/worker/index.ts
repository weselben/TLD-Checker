/** Worker entry: routes /api/* to the JSON API, everything else to the SPA
 *  via the ASSETS binding. */

import { handleCheck } from './api/check';
import { handleChallenge } from './api/challenge';
import { handleReport } from './api/report';
import { clientIp } from './lib/http';
import { VoteAgg } from './durable/vote-agg';
import type { Env } from './env';

export { VoteAgg };

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      return routeApi(url.pathname, request, env);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

async function routeApi(pathname: string, request: Request, env: Env): Promise<Response> {
  if (pathname === '/api/check' && request.method === 'GET') return handleCheck(request, env);
  if (pathname === '/api/challenge' && request.method === 'POST') {
    return handleChallenge(request, env, clientIp(request));
  }
  if (pathname === '/api/report' && request.method === 'POST') {
    return handleReport(request, env, clientIp(request));
  }
  return Response.json({ error: 'not found' }, { status: 404 });
}
