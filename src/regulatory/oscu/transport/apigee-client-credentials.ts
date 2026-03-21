/**
 * OAuth2 client-credentials token used by Postman “Access Token” request:
 * `GET {tokenBaseUrl}/v1/token/generate?grant_type=client_credentials` with HTTP Basic.
 */

export type FetchEtimsApigeeAccessTokenParams = {
  /** e.g. `https://sbx.kra.go.ke` (no trailing slash). */
  tokenBaseUrl?: string;
  clientId: string;
  clientSecret: string;
  timeoutMs?: number;
};

export type FetchEtimsApigeeAccessTokenResult = {
  accessToken: string;
  raw: Record<string, unknown>;
};

const DEFAULT_TOKEN_TTL_MS = 3600 * 1000;

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4;
  const padded = b64 + (pad ? '='.repeat(4 - pad) : '');
  try {
    const json = Buffer.from(padded, 'base64').toString('utf8');
    const v = JSON.parse(json) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    return v as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * When the token response omits `expires_in`, derive expiry from JWT `exp` (seconds) or fall back to 1h.
 */
export function resolveApigeeAccessTokenExpiresAtMs(
  raw: Record<string, unknown>,
  accessToken: string,
  nowMs = Date.now(),
): number {
  const expiresIn = raw['expires_in'];
  if (
    typeof expiresIn === 'number' &&
    Number.isFinite(expiresIn) &&
    expiresIn > 0
  ) {
    return nowMs + expiresIn * 1000;
  }
  if (typeof expiresIn === 'string') {
    const n = Number(expiresIn);
    if (Number.isFinite(n) && n > 0) return nowMs + n * 1000;
  }
  const payload = decodeJwtPayload(accessToken);
  const exp = payload?.['exp'];
  if (typeof exp === 'number' && Number.isFinite(exp) && exp > 0) {
    return exp * 1000;
  }
  return nowMs + DEFAULT_TOKEN_TTL_MS;
}

function safeRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * Fetches an Apigee access token for the eTIMS OSCU integrator gateway.
 */
export async function fetchEtimsApigeeAccessToken(
  params: FetchEtimsApigeeAccessTokenParams,
): Promise<FetchEtimsApigeeAccessTokenResult> {
  const base = (params.tokenBaseUrl ?? 'https://sbx.kra.go.ke').replace(
    /\/$/,
    '',
  );
  const url = `${base}/v1/token/generate?grant_type=client_credentials`;
  const timeoutMs = params.timeoutMs ?? 30_000;
  const basic = Buffer.from(
    `${params.clientId}:${params.clientSecret}`,
    'utf8',
  ).toString('base64');

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${basic}`,
      },
      signal: controller.signal,
    });
    const text = await res.text();
    const json: unknown = text ? JSON.parse(text) : null;
    const raw = safeRecord(json) ?? {};
    const accessToken =
      typeof raw.access_token === 'string'
        ? raw.access_token
        : typeof raw['access_token'] === 'string'
          ? raw['access_token']
          : '';
    if (!res.ok || !accessToken) {
      throw new Error(`Apigee token HTTP ${res.status}: ${text.slice(0, 500)}`);
    }
    return { accessToken, raw };
  } finally {
    clearTimeout(t);
  }
}
