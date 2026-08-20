import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import {
  Strategy,
  type Profile,
  type VerifyCallback,
} from 'passport-google-oauth20';
import { googleOAuthConfig } from '../oauth/google-oauth.config';
import type { OAuthProfile } from '../oauth/oauth-profile.type';

/**
 * Named 'google' (Passport's default strategy name for this class) -- picked
 * up by AuthGuard('google') in DashboardAuthController. See
 * google-oauth.config.ts for why boot never fails when env vars are unset.
 */
@Injectable()
export class GoogleOAuthStrategy extends PassportStrategy(Strategy, 'google') {
  constructor() {
    const config = googleOAuthConfig();
    super({
      clientID: config.clientID,
      clientSecret: config.clientSecret,
      callbackURL: config.callbackURL,
      scope: ['profile', 'email'],
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): void {
    const email = profile.emails?.[0]?.value;
    if (!email) {
      done(new Error('Google account has no email on file'));
      return;
    }

    const oauthProfile: OAuthProfile = {
      provider: 'google',
      subject: profile.id,
      email,
      emailVerified: profile.emails?.[0]?.verified !== false,
      firstName: profile.name?.givenName || profile.displayName || 'Google',
      lastName: profile.name?.familyName || 'User',
    };
    done(null, oauthProfile);
  }
}
