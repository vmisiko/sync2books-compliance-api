const DEV_FALLBACK_SECRET = 'dev-only-dashboard-secret-do-not-use-in-prod';

let warned = false;

/**
 * Shared by JwtModule (signing) and DashboardJwtStrategy (verification) so they
 * can never drift apart. Falls back to a fixed dev secret so local dev doesn't
 * hard-fail when `.env` isn't loaded into the process — but that fallback must
 * never reach a real deployment.
 */
export function dashboardJwtSecret(): string {
  const fromEnv = process.env.JWT_DASHBOARD_SECRET?.trim();
  if (fromEnv) return fromEnv;

  if (!warned) {
    warned = true;
    // eslint-disable-next-line no-console
    console.warn(
      '[dashboard-identity] JWT_DASHBOARD_SECRET is not set — using an insecure dev fallback. Set it before deploying.',
    );
  }
  return DEV_FALLBACK_SECRET;
}
