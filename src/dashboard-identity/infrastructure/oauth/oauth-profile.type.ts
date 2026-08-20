import type { DashboardOAuthProvider } from '../../domain/entities/dashboard-user.entity';

/** Normalized shape both strategies' validate() produce, so the application service never branches on provider. */
export interface OAuthProfile {
  provider: DashboardOAuthProvider;
  /** Provider's stable subject/user id -- see [[DashboardUser.oauthSubject]]. */
  subject: string;
  email: string;
  /** Only auto-link/auto-create when true -- see DashboardAuthApplicationService.loginOrSignUpWithOAuth. */
  emailVerified: boolean;
  firstName: string;
  lastName: string;
}
