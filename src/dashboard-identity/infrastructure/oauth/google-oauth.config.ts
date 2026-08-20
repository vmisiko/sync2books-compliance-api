const DEV_FALLBACK_CLIENT_ID = 'not-configured-google-client-id';
const DEV_FALLBACK_CLIENT_SECRET = 'not-configured-google-client-secret';

let warned = false;

export interface GoogleOAuthConfig {
  clientID: string;
  clientSecret: string;
  callbackURL: string;
  configured: boolean;
}

/**
 * Same fallback pattern as dashboardJwtSecret(): missing env vars must not
 * crash Nest DI at boot (PassportStrategy throws if clientID/clientSecret
 * are empty strings), so we fall back to placeholder values. `configured`
 * lets the controller reject the redirect with a clear 501 before ever
 * bouncing the user to Google with credentials that will fail there anyway.
 */
export function googleOAuthConfig(): GoogleOAuthConfig {
  const clientID = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  const callbackURL =
    process.env.GOOGLE_OAUTH_CALLBACK_URL?.trim() ||
    'http://localhost:3001/dashboard-api/auth/google/callback';

  const configured = Boolean(clientID && clientSecret);
  if (!configured && !warned) {
    warned = true;
    console.warn(
      '[dashboard-identity] GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET are not set — Google sign-in will return 501 until they are configured.',
    );
  }

  return {
    clientID: clientID || DEV_FALLBACK_CLIENT_ID,
    clientSecret: clientSecret || DEV_FALLBACK_CLIENT_SECRET,
    callbackURL,
    configured,
  };
}
