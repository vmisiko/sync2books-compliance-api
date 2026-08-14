import { randomUUID } from 'crypto';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { DASHBOARD_USER_REPO } from '../../shared/tokens';
import type { IDashboardUserRepository } from './ports/dashboard-user.repository.port';
import type { DashboardUser } from '../domain/entities/dashboard-user.entity';
import type { DashboardRole } from '../../shared/domain/enums/dashboard-role.enum';
import { ComplianceOrganizationApplicationService } from '../../compliance-organization/application/compliance-organization.application.service';

const BCRYPT_ROUNDS = 10;
const ACCESS_TOKEN_TTL_SECONDS = 3600;

export type DashboardAuthTokens = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
};

export type DashboardAuthResult = {
  user: Omit<DashboardUser, 'passwordHash'>;
  tenant: { id: string; displayName: string | null } | null;
  tokens: DashboardAuthTokens;
};

export type CreateDashboardUserInput = {
  email: string;
  password: string;
  displayName?: string | null;
  role: DashboardRole;
  complianceTenantId: string;
};

@Injectable()
export class DashboardAuthApplicationService {
  constructor(
    @Inject(DASHBOARD_USER_REPO)
    private readonly users: IDashboardUserRepository,
    private readonly jwt: JwtService,
    private readonly organization: ComplianceOrganizationApplicationService,
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

    const passwordValid = await bcrypt.compare(password, user.passwordHash);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.buildAuthResult(user);
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
      complianceTenantId: input.complianceTenantId,
      createdAt: now,
      updatedAt: now,
    });
  }

  async findByEmail(email: string): Promise<DashboardUser | null> {
    return this.users.findByEmail(email);
  }

  private async buildAuthResult(user: DashboardUser): Promise<DashboardAuthResult> {
    const tenant = await this.organization.getTenantById(user.complianceTenantId);

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.complianceTenantId,
    };

    const accessToken = this.jwt.sign(payload, {
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    });
    const refreshToken = this.jwt.sign(payload, { expiresIn: '7d' });

    return {
      user: this.toSafeUser(user),
      tenant: tenant ? { id: tenant.id, displayName: tenant.displayName } : null,
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
