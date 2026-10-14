// The GitHub quota endpoint is intentionally confined to the Host half. Never
// pass a credential, full upstream response, or upstream error body to the UI.
export const QUOTA_URL = 'https://api.github.com/copilot_internal/user';
export const CREDENTIAL_KEY = 'llm-pi-ai/github-copilot';

const nonnegative = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
const failure = (code, message, retryAfterSec) => ({
  ok: false,
  code,
  message,
  ...(retryAfterSec === undefined ? {} : { retryAfterSec }),
});

function resetAt(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d(?:T\d\d:\d\d:\d\d(?:\.\d+)?Z)?$/.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Normalize only the fields needed by a footer, not a copy of GitHub's private JSON. */
export function normalizeQuota(payload, sampledAt = new Date()) {
  const root = object(payload);
  const bucket = object(object(root?.quota_snapshots)?.premium_interactions);
  if (!bucket) return failure('quota-unavailable', 'GitHub 未提供此账号的可读配额。');

  // Since June 2026 this SAME bucket can denote AI credits or legacy premium
  // requests. The explicit marker, not the bucket's name, determines the unit.
  const marker = typeof bucket.token_based_billing === 'boolean'
    ? bucket.token_based_billing
    : root?.token_based_billing;
  const unit = marker === true ? 'credits' : marker === false ? 'requests' : 'unknown';
  const allowance = nonnegative(bucket.entitlement);
  const balance = nonnegative(bucket.remaining);
  const finiteAllowance = bucket.unlimited !== true && allowance !== null && allowance > 0
    && balance !== null && balance <= allowance;
  const total = finiteAllowance ? allowance : null;
  const remaining = finiteAllowance ? balance : null;
  const includedUsed = finiteAllowance ? Math.max(0, allowance - balance) : null;
  // GitHub may explicitly report credits_used even when it differs from the
  // change in included balance (adjustments/overage). Prefer its reported
  // usage; use entitlement-minus-remaining only when no such field exists.
  // Organization-managed seats can report usage without a personal allowance.
  const reportedUsed = unit === 'credits' ? nonnegative(bucket.credits_used) : null;
  const used = reportedUsed ?? includedUsed;
  if (used === null) return failure('quota-unavailable', '没有可计算的个人配额；组织订阅可能只提供共享额度。');

  const plan = typeof root.copilot_plan === 'string' ? root.copilot_plan.slice(0, 60) : null;
  const date = sampledAt instanceof Date ? sampledAt : new Date(sampledAt);
  return {
    ok: true,
    unit,
    used,
    remaining,
    total,
    overage: nonnegative(bucket.overage_count),
    plan,
    resetAt: resetAt(root.quota_reset_date_utc ?? root.quota_reset_date),
    sampledAt: date.toISOString(),
    approximate: true,
    scope: finiteAllowance ? 'personal' : 'shared-or-unknown',
  };
}

/** A single server-side, read-only GitHub request using pi-ai's *GitHub* grant. */
export async function readQuota(credentials, fetcher = globalThis.fetch, clock = () => new Date()) {
  let record;
  try {
    record = await credentials.readRecord(CREDENTIAL_KEY);
  } catch {
    return failure('credential-error', '无法读取本地 Copilot 登录记录。');
  }
  if (!record) return failure('not-signed-in', '尚未在 DSH 登录 GitHub Copilot。');
  const token = record.kind === 'grant' ? object(record.payload)?.refresh : undefined;
  // pi-ai payload.access is an expiring *Copilot proxy* token and MUST NOT be
  // sent to api.github.com. payload.refresh is the GitHub OAuth access token.
  if (typeof token !== 'string' || token.length < 8 || token.length > 4096 || /[\r\n]/.test(token)) {
    return failure('unsupported-credential', '本地登录记录不包含可查询用量的 GitHub 授权。');
  }

  let response;
  try {
    response = await fetcher(QUOTA_URL, {
      method: 'GET',
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/json',
        'User-Agent': 'dsh-github-copilot-credits',
      },
      signal: AbortSignal.timeout(9000),
    });
  } catch {
    return failure('network', '无法连接 GitHub 用量接口，请稍后重试。');
  }
  if (response.status === 401) return failure('github-auth', 'GitHub 授权已失效，请重新登录 Copilot。');
  if (response.status === 403) return failure('github-forbidden', 'GitHub 拒绝读取该账号的 Copilot 用量。');
  if (response.status === 429) {
    const wait = Number(response.headers?.get?.('retry-after'));
    return failure('rate-limit', 'GitHub 暂时限制用量查询，请稍后重试。',
      Number.isFinite(wait) && wait > 0 ? Math.min(Math.ceil(wait), 600) : 60);
  }
  if (!response.ok) return failure('github-unavailable', 'GitHub 用量接口暂不可用。');
  let payload;
  try {
    // The upstream response is not logged or returned. A size cap protects the
    // local host from accidentally processing a large, unexpected response.
    const body = await response.text();
    if (body.length > 262144) return failure('bad-response', 'GitHub 用量响应超出预期。');
    payload = JSON.parse(body);
  } catch {
    return failure('bad-response', '无法解析 GitHub 用量响应。');
  }
  return normalizeQuota(payload, clock());
}
