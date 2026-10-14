import { CREDENTIAL_KEY, readQuota } from './quota.js';

/** Host half: only a small authenticated same-origin JSON route reaches the UI. */
export const name = 'github-copilot-credits';
export const inject = ['connection', 'credentials'];
export const Config = undefined;

export function apply(ctx) {
  let cached = null;
  let expiresAt = 0;
  let pending = null;
  let generation = 0;

  // A sign-in, sign-out or pi-ai token rotation must not leave an old account's
  // figures in the cache. An in-flight response is not allowed to repopulate it.
  ctx.on('credentials/record-updated', (key) => {
    if (key !== CREDENTIAL_KEY) return;
    generation += 1;
    cached = null;
    pending = null;
    expiresAt = 0;
  });

  const current = async (force) => {
    const now = Date.now();
    if (pending !== null) return pending;
    // Explicit panel Refresh bypasses the normal cache, but respects GitHub's
    // Retry-After when the previous request was rate-limited.
    if (cached !== null && now < expiresAt && (!force || cached.code === 'rate-limit')) return cached;
    const startedGeneration = generation;
    const operation = readQuota(ctx.credentials)
      .catch(() => ({ ok: false, code: 'unexpected', message: '查询 Copilot 用量时发生错误。' }))
      .then((result) => {
        if (generation !== startedGeneration) {
          return { ok: false, code: 'account-changed', message: 'Copilot 登录已变更，请重新查询用量。' };
        }
        cached = result;
        const ttl = result.ok ? 90000 : (result.retryAfterSec ?? 30) * 1000;
        expiresAt = Date.now() + ttl;
        return result;
      });
    pending = operation;
    void operation.finally(() => { if (pending === operation) pending = null; });
    return operation;
  };

  // Connection owns the /api transport's Host, Origin and session-cookie checks.
  // Do not mount a bare webServer route: it would bypass that authentication.
  ctx.connection.fetch.register({
    path: '/api/copilot-credits',
    methods: ['GET'],
    requestBody: 'buffered',
    async fetch(request) {
      const result = await current(new URL(request.url).searchParams.get('refresh') === '1');
      return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
    },
  });
}
