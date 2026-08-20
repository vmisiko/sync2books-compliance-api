import { randomBytes, randomUUID } from 'crypto';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { DASHBOARD_USER_REPO } from '../../shared/tokens';
import type { IDashboardUserRepository } from './ports/dashboard-user.repository.port';
import type {
  DashboardUser,
  DashboardUserStatus,
} from '../domain/entities/dashboard-user.entity';
import { DashboardRole } from '../../shared/domain/enums/dashboard-role.enum';
import { DashboardOrganizationApplicationService } from '../../dashboard-organization/application/dashboard-organization.application.service';
import type { DashboardOrganization } from '../../dashboard-organization/domain/entities/dashboard-organization.entity';
import type { OAuthProfile } from '../infrastructure/oauth/oauth-profile.type';

const BCRYPT_ROUNDS = 10;
const ACCESS_TOKEN_TTL_SECONDS = 3600;
/** Short-lived -- just long enough for the "what's your company name?" hop between the OAuth callback redirect and /auth/oauth/complete. */
const OAUTH_TICKET_TTL = '15m';
const OAUTH_TICKET_TYPE = 'oauth_ticket';

export type DashboardAuthTokens = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
};

export type DashboardOrganizationSummary = {
  id: string;
  displayName: string;
};

export type DashboardAuthResult = {
  user: Omit<DashboardUser, 'passwordHash'>;
  organization: DashboardOrganizationSummary;
  tokens: DashboardAuthTokens;
};

export type CreateDashboardUserInput = {
  email: string;
  password: string;
  displayName?: string | null;
  role: DashboardRole;
  organizationId: string;
};

export type SignUpInput = {
  organizationName: string;
  firstName: string;
  lastName: string;
  email: string;
  password: string;
};

type OAuthTicketPayload = {
  type: typeof OAUTH_TICKET_TYPE;
  provider: OAuthProfile['provider'];
  subject: string;
  email: string;
  firstName: string;
  lastName: string;
};

/** Returned instead of DashboardAuthResult when the OAuth email has never signed up before -- there's no organization to attach the new user to yet, so the frontend must collect one via /auth/oauth/complete before an account (and any tokens) exist. */
export type PendingOAuthSignUp = {
  pending: true;
  ticket: string;
  email: string;
  firstName: string;
  lastName: string;
};

@Injectable()
export class DashboardAuthApplicationService {
  constructor(
    @Inject(DASHBOARD_USER_REPO)
    private readonly users: IDashboardUserRepository,
    private readonly jwt: JwtService,
    private readonly organizations: DashboardOrganizationApplicationService,
  ) {}

  async login(email: string, password: string): Promise<DashboardAuthResult> {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) {
      throw new UnauthorizedException('Email and password are required');
    }

    const user = await this.users.findByEmail(normalizedEmail);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.passwordHash) {
      throw new UnauthorizedException(
        `This account signs in with ${user.oauthProvider === 'microsoft' ? 'Microsoft' : 'Google'} — use that button instead of a password.`,
      );
    }

    const passwordValid = await bcrypt.compare(password, user.passwordHash);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status === 'deactivated') {
      throw new UnauthorizedException('This account has been deactivated');
    }

    return this.buildAuthResult(user);
  }

  /**
   * Real self-serve signup: provisions a DashboardOrganization (which
   * auto-creates the matching main-API Organization + Application, see
   * DashboardOrganizationApplicationService.provisionForSignup), then the
   * first admin DashboardUser under it. Does not create any business —
   * matches the empty "no businesses yet" landing state.
   */
  async signUp(input: SignUpInput): Promise<DashboardAuthResult> {
    const normalizedEmail = input.email.trim().toLowerCase();
    const existing = await this.users.findByEmail(normalizedEmail);
    if (existing) {
      throw new UnauthorizedException(
        'An account with this email already exists',
      );
    }

    const organization = await this.organizations.provisionForSignup({
      displayName: input.organizationName,
      adminFirstName: input.firstName,
      adminLastName: input.lastName,
      adminEmail: normalizedEmail,
      adminPassword: input.password,
    });

    const user = await this.createUser({
      email: normalizedEmail,
      password: input.password,
      displayName: `${input.firstName} ${input.lastName}`.trim(),
      role: DashboardRole.ADMIN,
      organizationId: organization.id,
    });

    return this.buildAuthResult(user, organization);
  }

  async me(userId: string): Promise<DashboardAuthResult['user']> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }
    return this.toSafeUser(user);
  }

  async createUser(input: CreateDashboardUserInput): Promise<DashboardUser> {
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
    const now = new Date();
    return this.users.save({
      id: randomUUID(),
      email: input.email.trim().toLowerCase(),
      passwordHash,
      displayName: input.displayName ?? null,
      role: input.role,
      organizationId: input.organizationId,
      status: 'active',
      oauthProvider: null,
      oauthSubject: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  /**
   * Entry point for both OAuth buttons -- one flow handles login and signup
   * since the provider already proved who the person is:
   *  - Known email, no prior OAuth link (password account): auto-link this
   *    provider to it, but only when the provider reports the email verified
   *    -- an unverified email is just a claim, not proof of ownership.
   *  - Known email, already linked to *some* provider: log straight in.
   *    Re-consent under a second provider is treated as the same person
   *    rather than rejected, since Sync2Books doesn't ask which provider to
   *    use again on later sign-ins.
   *  - Unknown email: there is no organization to attach a new user to yet
   *    (unlike password signup, which collects one in the same form), so
   *    this returns a short-lived ticket instead of creating anything --
   *    /auth/oauth/complete finishes the job once the frontend collects a
   *    company name.
   */
  async loginOrSignUpWithOAuth(
    profile: OAuthProfile,
  ): Promise<DashboardAuthResult | PendingOAuthSignUp> {
    const normalizedEmail = profile.email.trim().toLowerCase();
    const existing = await this.users.findByEmail(normalizedEmail);

    if (existing) {
      if (existing.status === 'deactivated') {
        throw new UnauthorizedException('This account has been deactivated');
      }

      if (!existing.oauthProvider) {
        if (!profile.emailVerified) {
          throw new UnauthorizedException(
            `${normalizedEmail} already has a password account and this ${profile.provider} email is not verified -- sign in with your password instead.`,
          );
        }
        const linked = await this.users.save({
          ...existing,
          oauthProvider: profile.provider,
          oauthSubject: profile.subject,
          updatedAt: new Date(),
        });
        return this.buildAuthResult(linked);
      }

      return this.buildAuthResult(existing);
    }

    if (!profile.emailVerified) {
      throw new UnauthorizedException(
        `Your ${profile.provider} account's email is not verified -- verify it with ${profile.provider === 'microsoft' ? 'Microsoft' : 'Google'} first, then try again.`,
      );
    }

    const ticketPayload: OAuthTicketPayload = {
      type: OAUTH_TICKET_TYPE,
      provider: profile.provider,
      subject: profile.subject,
      email: normalizedEmail,
      firstName: profile.firstName,
      lastName: profile.lastName,
    };
    const ticket = this.jwt.sign(ticketPayload, {
      expiresIn: OAUTH_TICKET_TTL,
    });

    return {
      pending: true,
      ticket,
      email: normalizedEmail,
      firstName: profile.firstName,
      lastName: profile.lastName,
    };
  }

  /** Second half of a brand-new OAuth signup -- see loginOrSignUpWithOAuth. */
  async completeOAuthSignUp(
    ticket: string,
    organizationName: string,
  ): Promise<DashboardAuthResult> {
    let payload: OAuthTicketPayload;
    try {
      payload = this.jwt.verify<OAuthTicketPayload>(ticket);
    } catch {
      throw new UnauthorizedException(
        'This sign-up link has expired -- please try again',
      );
    }
    if (payload.type !== OAUTH_TICKET_TYPE) {
      throw new UnauthorizedException('Invalid sign-up ticket');
    }

    // Re-check for a race: two tabs completing the same ticket, or the
    // person signed up another way in between.
    const existing = await this.users.findByEmail(payload.email);
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    // The main API's own /auth/signup (called inside provisionForSignup)
    // requires a password -- there isn't a user-chosen one for an OAuth
    // signup, so a random one is generated here purely to satisfy that
    // contract. It's discarded immediately after: this dashboard user logs
    // in only via [[loginOrSignUpWithOAuth]] from now on (see the null
    // passwordHash guard in login()).
    const mainApiProvisioningPassword = randomBytes(24).toString('base64url');

    const organization = await this.organizations.provisionForSignup({
      displayName: organizationName,
      adminFirstName: payload.firstName,
      adminLastName: payload.lastName,
      adminEmail: payload.email,
      adminPassword: mainApiProvisioningPassword,
    });

    const user = await this.createOAuthUser({
      email: payload.email,
      displayName: `${payload.firstName} ${payload.lastName}`.trim(),
      role: DashboardRole.ADMIN,
      organizationId: organization.id,
      oauthProvider: payload.provider,
      oauthSubject: payload.subject,
    });

    return this.buildAuthResult(user, organization);
  }

  private async createOAuthUser(input: {
    email: string;
    displayName: string | null;
    role: DashboardRole;
    organizationId: string;
    oauthProvider: OAuthProfile['provider'];
    oauthSubject: string;
  }): Promise<DashboardUser> {
    const now = new Date();
    return this.users.save({
      id: randomUUID(),
      email: input.email.trim().toLowerCase(),
      passwordHash: null,
      displayName: input.displayName,
      role: input.role,
      organizationId: input.organizationId,
      status: 'active',
      oauthProvider: input.oauthProvider,
      oauthSubject: input.oauthSubject,
      createdAt: now,
      updatedAt: now,
    });
  }

  async listMembers(
    organizationId: string,
  ): Promise<Array<DashboardAuthResult['user']>> {
    const users = await this.users.listByOrganizationId(organizationId);
    return users.map((u) => this.toSafeUser(u));
  }

  /** Role/status edits, scoped to the caller's own organization -- a member from a different org 404s, never a silent no-op or cross-org leak. */
  async updateMember(
    organizationId: string,
    memberId: string,
    input: { role?: DashboardRole; status?: DashboardUserStatus },
  ): Promise<DashboardAuthResult['user']> {
    const member = await this.users.findById(memberId);
    if (!member || member.organizationId !== organizationId) {
      throw new NotFoundException(`Member ${memberId} not found`);
    }

    const updated = await this.users.save({
      ...member,
      role: input.role ?? member.role,
      status: input.status ?? member.status,
      updatedAt: new Date(),
    });
    return this.toSafeUser(updated);
  }

  async findByEmail(email: string): Promise<DashboardUser | null> {
    return this.users.findByEmail(email);
  }

  private async buildAuthResult(
    user: DashboardUser,
    knownOrganization?: DashboardOrganization,
  ): Promise<DashboardAuthResult> {
    const organization =
      knownOrganization ??
      (await this.organizations.getById(user.organizationId));

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
    };

    const accessToken = this.jwt.sign(payload, {
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    });
    const refreshToken = this.jwt.sign(payload, { expiresIn: '7d' });

    return {
      user: this.toSafeUser(user),
      organization: {
        id: organization.id,
        displayName: organization.displayName,
      },
      tokens: {
        accessToken,
        refreshToken,
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
        tokenType: 'Bearer',
      },
    };
  }

  private toSafeUser(user: DashboardUser): DashboardAuthResult['user'] {
    const { passwordHash: _passwordHash, ...safe } = user;
    return safe;
  }
}
