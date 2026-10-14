import test from 'node:test';
import assert from 'node:assert/strict';
import { CREDENTIAL_KEY, QUOTA_URL, normalizeQuota, readQuota } from '../quota.js';
import { apply, inject, name } from '../index.js';

const personal = {
  copilot_plan: 'pro+',
  token_based_billing: true,
  quota_reset_date_utc: '2026-11-01T00:00:00.000Z',
  quota_snapshots: {
    premium_interactions: {
      entitlement: 7000, remaining: 6769, overage_count: 0,
      unlimited: false, token_based_billing: true,
    },
  },
};

const gitGrant = (refresh = 'gho_stable_test_secret') => ({
  kind: 'grant',
  payload: { access: 'copilot-proxy-token-DO-NOT-SEND', refresh },
});

function response(body, status = 200, headers = undefined) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
}

test('normalizes personal AI credits, UTC reset, without guessing fixed plan limits', () => {
  const result = normalizeQuota(personal, new Date('2026-10-07T00:00:00Z'));
  assert.deepEqual(result, {
    ok: true, unit: 'credits', used: 231, remaining: 6769, total: 7000,
    overage: 0, plan: 'pro+', resetAt: '2026-11-01T00:00:00.000Z',
    sampledAt: '2026-10-07T00:00:00.000Z', approximate: true, scope: 'personal',
  });
});

test('when GitHub reports used credits explicitly, do not overwrite them with quota delta', () => {
  const snapshot = structuredClone(personal);
  snapshot.copilot_plan = 'business';
  snapshot.quota_snapshots.premium_interactions.entitlement = 30000;
  snapshot.quota_snapshots.premium_interactions.remaining = 28811;
  snapshot.quota_snapshots.premium_interactions.credits_used = 789;
  const result = normalizeQuota(snapshot);
  assert.equal(result.used, 789);
  assert.equal(result.remaining, 28811);
  assert.equal(result.total, 30000);
});

test('legacy requests and unmarked bucket are never mislabeled Credits', () => {
  const legacy = structuredClone(personal);
  legacy.token_based_billing = false;
  legacy.quota_snapshots.premium_interactions.token_based_billing = false;
  assert.equal(normalizeQuota(legacy).unit, 'requests');
  delete legacy.token_based_billing;
  delete legacy.quota_snapshots.premium_interactions.token_based_billing;
  assert.equal(normalizeQuota(legacy).unit, 'unknown');
  legacy.quota_snapshots.premium_interactions.remaining = -1;
  assert.equal(normalizeQuota(legacy).ok, false);
});

test('unlimited organization seat has no false zero-percent personal quota', () => {
  const org = {
    copilot_plan: 'business', token_based_billing: true, quota_reset_date: '2026-11-01',
    quota_snapshots: { premium_interactions: {
      unlimited: true, entitlement: 0, remaining: 0, credits_used: 31,
    } },
  };
  const result = normalizeQuota(org);
  assert.equal(result.used, 31);
  assert.equal(result.total, null);
  assert.equal(result.remaining, null);
  assert.equal(result.scope, 'shared-or-unknown');
  assert.equal(result.resetAt, '2026-11-01T00:00:00.000Z');
  delete org.quota_snapshots.premium_interactions.credits_used;
  assert.equal(normalizeQuota(org).code, 'quota-unavailable');
});

test('malformed quota cannot masquerade as a valid zero', () => {
  for (const item of [null, {}, { quota_snapshots: { premium_interactions: {
    entitlement: 0, remaining: 0, unlimited: true,
  } } }, { quota_snapshots: { premium_interactions: {
    entitlement: 10, remaining: 11,
  } } }]) {
    assert.equal(normalizeQuota(item).ok, false);
  }
});

test('GitHub receives only the long-lived GitHub grant; output hides secrets', async () => {
  const credential = gitGrant();
  let calls = 0;
  const result = await readQuota(
    { readRecord: async (key) => { assert.equal(key, CREDENTIAL_KEY); return credential; } },
    async (url, options) => {
      calls++;
      assert.equal(url, QUOTA_URL);
      assert.equal(options.method, 'GET');
      assert.equal(options.headers.Authorization, `token ${credential.payload.refresh}`);
      assert.ok(!JSON.stringify(options).includes(credential.payload.access));
      return response({ ...personal, extra: credential.payload.refresh });
    },
  );
  assert.equal(calls, 1);
  assert.equal(result.used, 231);
  assert.ok(!JSON.stringify(result).includes(credential.payload.refresh));
});

test('missing or incompatible grant never contacts GitHub', async () => {
  const failIfCalled = () => { throw new Error('unexpected network access'); };
  assert.equal((await readQuota({ readRecord: async () => undefined }, failIfCalled)).code, 'not-signed-in');
  assert.equal((await readQuota({ readRecord: async () => ({ kind: 'grant', payload: { access: 'proxy' } }) }, failIfCalled)).code,
    'unsupported-credential');
});

test('upstream failures are bounded and no raw upstream body reaches browser', async () => {
  const creds = { readRecord: async () => gitGrant() };
  for (const [status, expected] of [[401, 'github-auth'], [403, 'github-forbidden'], [429, 'rate-limit'], [502, 'github-unavailable']]) {
    const result = await readQuota(creds, async () => response('TOP_SECRET_FROM_UPSTREAM', status, { 'retry-after': '95' }));
    assert.equal(result.code, expected);
    assert.ok(!JSON.stringify(result).includes('TOP_SECRET_FROM_UPSTREAM'));
    if (status === 429) assert.equal(result.retryAfterSec, 95);
  }
  const malformed = await readQuota(creds, async () => response('{not json'));
  assert.equal(malformed.code, 'bad-response');
  assert.equal((await readQuota(creds, async () => { throw new Error('SECRET NETWORK DETAIL'); })).code, 'network');
});

test('Host registers only one authenticated GET route, caches, and invalidates on new sign-in', async () => {
  assert.equal(name, 'github-copilot-credits');
  assert.deepEqual(inject, ['connection', 'credentials']);
  let registered;
  let record = gitGrant('gho_old_secret');
  let listener;
  const ctx = {
    connection: { fetch: { register(route) { registered = route; } } },
    credentials: { readRecord: async () => record },
    on(event, callback) { assert.equal(event, 'credentials/record-updated'); listener = callback; },
  };
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async (_url, options) => {
    networkCalls++;
    assert.equal(options.headers.Authorization, `token ${record.payload.refresh}`);
    return response(personal);
  };
  try {
    apply(ctx);
    assert.equal(registered.path, '/api/copilot-credits');
    assert.deepEqual(registered.methods, ['GET']);
    const request = new Request('http://127.0.0.1:19387/api/copilot-credits');
    const first = await registered.fetch(request);
    assert.equal(first.headers.get('cache-control'), 'no-store');
    assert.equal((await first.json()).remaining, 6769);
    await registered.fetch(request);
    assert.equal(networkCalls, 1);
    record = gitGrant('gho_new_secret');
    listener(CREDENTIAL_KEY);
    const changed = await registered.fetch(request);
    assert.equal((await changed.json()).used, 231);
    assert.equal(networkCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a sign-out during an in-flight query cannot publish the old account quota', async () => {
  let route;
  let onChange;
  let record = gitGrant();
  let release;
  const hold = new Promise((resolve) => { release = resolve; });
  const ctx = {
    connection: { fetch: { register(value) { route = value; } } },
    credentials: { readRecord: async () => record },
    on(_event, callback) { onChange = callback; },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { await hold; return response(personal); };
  try {
    apply(ctx);
    const request = new Request('http://127.0.0.1:19387/api/copilot-credits');
    const first = route.fetch(request);
    await new Promise((resolve) => setImmediate(resolve));
    record = undefined;
    onChange(CREDENTIAL_KEY);
    release();
    assert.equal((await (await first).json()).code, 'account-changed');
    assert.equal((await (await route.fetch(request)).json()).code, 'not-signed-in');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('panel Refresh bypasses success cache but respects GitHub rate-limit backoff', async () => {
  let route;
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls++;
    return calls === 1 ? response(personal) : response('rate limited', 429, { 'retry-after': '90' });
  };
  try {
    apply({
      connection: { fetch: { register(value) { route = value; } } },
      credentials: { readRecord: async () => gitGrant() },
      on() {},
    });
    const normal = new Request('http://127.0.0.1:19387/api/copilot-credits');
    const manual = new Request('http://127.0.0.1:19387/api/copilot-credits?refresh=1');
    assert.equal((await (await route.fetch(normal)).json()).used, 231);
    await route.fetch(normal);
    assert.equal(calls, 1, 'normal polling uses the Host cache');
    assert.equal((await (await route.fetch(manual)).json()).code, 'rate-limit');
    assert.equal(calls, 2, 'explicit Refresh makes a new GitHub request');
    await route.fetch(manual);
    assert.equal(calls, 2, 'even explicit Refresh honors upstream Retry-After');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
