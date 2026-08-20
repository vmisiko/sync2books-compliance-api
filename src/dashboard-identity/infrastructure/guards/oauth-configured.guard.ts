import {
  CanActivate,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { googleOAuthConfig } from '../oauth/google-oauth.config';
import { microsoftOAuthConfig } from '../oauth/microsoft-oauth.config';

/**
 * Must run *before* AuthGuard('google')/AuthGuard('microsoft') in the guard
 * chain (guards run in array order) -- passport's own guard redirects to the
 * provider's consent screen as a side effect of canActivate() itself, so a
 * "not configured" check placed in the route handler body never runs: the
 * handler is never reached once passport has already sent the redirect.
 */
@Injectable()
export class GoogleOAuthConfiguredGuard implements CanActivate {
  canActivate(): boolean {
    if (!googleOAuthConfig().configured) {
      throw new ServiceUnavailableException(
        'Google sign-in is not configured yet (GOOGLE_OAUTH_CLIENT_ID/SECRET missing)',
      );
    }
    return true;
  }
}

@Injectable()
export class MicrosoftOAuthConfiguredGuard implements CanActivate {
  canActivate(): boolean {
    if (!microsoftOAuthConfig().configured) {
      throw new ServiceUnavailableException(
        'Microsoft sign-in is not configured yet (MICROSOFT_OAUTH_CLIENT_ID/SECRET missing)',
      );
    }
    return true;
  }
}
