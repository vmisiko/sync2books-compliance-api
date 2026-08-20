import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import * as OAuth2Strategy from 'passport-oauth2';
import { microsoftOAuthConfig } from '../oauth/microsoft-oauth.config';
import type { OAuthProfile } from '../oauth/oauth-profile.type';

interface MicrosoftGraphMe {
  id: string;
  displayName?: string;
  givenName?: string;
  surname?: string;
  mail?: string | null;
  userPrincipalName?: string;
}

/**
 * Microsoft has no actively-maintained passport strategy of its own (unlike
 * Google's), so this subclasses the generic passport-oauth2 Strategy against
 * the Microsoft identity platform v2.0 endpoints and overrides userProfile()
 * to call Graph's /me directly with the access token -- same approach Auth0
 * and NextAuth's Microsoft providers use under the hood.
 */
@Injectable()
export class MicrosoftOAuthStrategy extends PassportStrategy(
  OAuth2Strategy,
  'microsoft',
) {
  constructor() {
    const config = microsoftOAuthConfig();
    super({
      authorizationURL: `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/authorize`,
      tokenURL: `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`,
      clientID: config.clientID,
      clientSecret: config.clientSecret,
      callbackURL: config.callbackURL,
      scope: ['openid', 'profile', 'email', 'User.Read'],
    });
  }

  userProfile(
    accessToken: string,
    done: (err?: unknown, profile?: unknown) => void,
  ): void {
    this._oauth2.get(
      'https://graph.microsoft.com/v1.0/me',
      accessToken,
      (err, body) => {
        if (err || !body) {
          done(new Error('Failed to fetch Microsoft Graph profile'));
          return;
        }
        try {
          done(null, JSON.parse(body.toString()) as MicrosoftGraphMe);
        } catch {
          done(new Error('Could not parse Microsoft Graph profile response'));
        }
      },
    );
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: MicrosoftGraphMe,
    done: OAuth2Strategy.VerifyCallback,
  ): void {
    // `mail` is only populated for a real, verified mailbox -- `userPrincipalName`
    // is a sign-in identifier that isn't guaranteed deliverable/verified for every
    // account type, so falling back to it must not be treated as verified.
    const email = profile.mail || profile.userPrincipalName;
    if (!email) {
      done(new Error('Microsoft account has no email on file'));
      return;
    }

    const oauthProfile: OAuthProfile = {
      provider: 'microsoft',
      subject: profile.id,
      email,
      emailVerified: Boolean(profile.mail),
      firstName: profile.givenName || profile.displayName || 'Microsoft',
      lastName: profile.surname || 'User',
    };
    done(null, oauthProfile);
  }
}
