const DEV_FALLBACK_CLIENT_ID = 'not-configured-microsoft-client-id';
const DEV_FALLBACK_CLIENT_SECRET = 'not-configured-microsoft-client-secret';

let warned = false;

export interface MicrosoftOAuthConfig {
  clientID: string;
  clientSecret: string;
  callbackURL: string;
  /** Entra tenant to authorize against -- 'common' accepts both personal Microsoft accounts and any work/school (Azure AD) tenant, which is what a "Sign in with Microsoft" button on a public signup page should use. */
  tenantId: string;
  configured: boolean;
}

/** Same fallback pattern as googleOAuthConfig()/dashboardJwtSecret() -- see google-oauth.config.ts. */
export function microsoftOAuthConfig(): MicrosoftOAuthConfig {
  const clientID = process.env.MICROSOFT_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.MICROSOFT_OAUTH_CLIENT_SECRET?.trim();
  const callbackURL =
    process.env.MICROSOFT_OAUTH_CALLBACK_URL?.trim() ||
    'http://localhost:3001/dashboard-api/auth/microsoft/callback';
  const tenantId = process.env.MICROSOFT_OAUTH_TENANT_ID?.trim() || 'common';

  const configured = Boolean(clientID && clientSecret);
  if (!configured && !warned) {
    warned = true;
    console.warn(
      '[dashboard-identity] MICROSOFT_OAUTH_CLIENT_ID / MICROSOFT_OAUTH_CLIENT_SECRET are not set — Microsoft sign-in will return 501 until they are configured.',
    );
  }

  return {
    clientID: clientID || DEV_FALLBACK_CLIENT_ID,
    clientSecret: clientSecret || DEV_FALLBACK_CLIENT_SECRET,
    callbackURL,
    tenantId,
    configured,
  };
}
