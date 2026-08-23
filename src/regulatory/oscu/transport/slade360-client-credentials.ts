/**
 * OAuth2 client-credentials token for Slade360's identity host (Keycloak).
 * Confirmed live against `docs.slade360.com/docs/eTIMS/How-To-Guides/Start-Using-the-eTIMS-API`:
 * `POST {authBaseUrl}/realms/slade360/protocol/openid-connect/token`, form-encoded body,
 * response has `access_token` / `expires_in` (1800s) / `token_type: "Bearer"` and no
 * `refresh_token` — always request a fresh token on expiry rather than refreshing.
 */

export type FetchSlade360AccessTokenParams = {
  /** e.g. `https://identity-dev.slade360edi.com` (no trailing slash). */
  authBaseUrl: string;
  clientId: string;
  clientSecret: string;
  timeoutMs?: number;
};

export type FetchSlade360AccessTokenResult = {
  accessToken: string;
  raw: Record<string, unknown>;
};

function safeRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export async function fetchSlade360AccessToken(
  params: FetchSlade360AccessTokenParams,
): Promise<FetchSlade360AccessTokenResult> {
  const base = params.authBaseUrl.replace(/\/$/, '');
  const url = `${base}/realms/slade360/protocol/openid-connect/token`;
  const timeoutMs = params.timeoutMs ?? 30_000;

  const body = new URLSearchParams({
    client_id: params.clientId,
    client_secret: params.clientSecret,
    grant_type: 'client_credentials',
  });

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
      signal: controller.signal,
    });
    const text = await res.text();
    const json: unknown = text ? JSON.parse(text) : null;
    const raw = safeRecord(json) ?? {};
    const accessToken =
      typeof raw.access_token === 'string' ? raw.access_token : '';
    if (!res.ok || !accessToken) {
      throw new Error(
        `Slade360 token HTTP ${res.status}: ${text.slice(0, 500)}`,
      );
    }
    return { accessToken, raw };
  } finally {
    clearTimeout(t);
  }
}

/**
 * `expires_in` is always present in practice (1800), but fall back defensively
 * the same way `resolveApigeeAccessTokenExpiresAtMs` does for the KRA token.
 */
export function resolveSlade360AccessTokenExpiresAtMs(
  raw: Record<string, unknown>,
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
  return nowMs + 25 * 60 * 1000;
}
