import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  COMPLIANCE_API_KEY_REPO,
  COMPLIANCE_APPLICATION_REPO,
} from '../../shared/tokens';
import { ConnectionEnvironment } from '../../shared/domain/enums/connection-environment.enum';
import { generateApiKey } from '../domain/api-key';
import {
  ALL_API_KEY_SCOPES,
  ApiKeyScope,
  isApiKeyScope,
} from '../domain/api-key-scope.enum';
import type { ComplianceApiKey } from '../domain/entities/compliance-api-key.entity';
import type { ComplianceApplication } from '../domain/entities/compliance-application.entity';
import type { IComplianceApiKeyRepository } from './ports/compliance-api-key.repository.port';
import type { IComplianceApplicationRepository } from './ports/compliance-application.repository.port';

export const DEFAULT_RATE_LIMIT_PER_MIN = 120;
const MAX_RATE_LIMIT_PER_MIN = 6000;

/** An API key as it is safe to return: never the secret, except once at creation. */
export type ApiKeySummary = Omit<ComplianceApiKey, 'keyHash'>;

export type CreatedApiKey = {
  key: ApiKeySummary;
  /**
   * The only time the secret is ever returned. It is not stored, so it cannot
   * be shown again — the caller either copies it now or rotates.
   */
  plaintext: string;
};

function toSummary(key: ComplianceApiKey): ApiKeySummary {
  const { keyHash: _keyHash, ...rest } = key;
  return rest;
}

/**
 * Applications and API keys for a merchant's own developers.
 *
 * Every method takes the caller's `organizationId` and checks it, rather than
 * trusting a resolved object handed in from a controller. Ownership is not a
 * presentation concern.
 */
@Injectable()
export class DeveloperPlatformApplicationService {
  constructor(
    @Inject(COMPLIANCE_APPLICATION_REPO)
    private readonly applications: IComplianceApplicationRepository,
    @Inject(COMPLIANCE_API_KEY_REPO)
    private readonly keys: IComplianceApiKeyRepository,
  ) {}

  async listApplications(
    organizationId: string,
  ): Promise<ComplianceApplication[]> {
    return this.applications.findByOrganizationId(organizationId);
  }

  async createApplication(input: {
    organizationId: string;
    name: string;
    description?: string | null;
    createdByUserId?: string | null;
  }): Promise<ComplianceApplication> {
    const name = input.name?.trim();
    if (!name) {
      throw new BadRequestException('Application name is required');
    }

    const now = new Date();
    return this.applications.save({
      id: randomUUID(),
      organizationId: input.organizationId,
      name,
      description: input.description?.trim() || null,
      status: 'active',
      rateLimitPerMin: DEFAULT_RATE_LIMIT_PER_MIN,
      createdByUserId: input.createdByUserId ?? null,
      createdAt: now,
      updatedAt: now,
    });
  }

  async updateApplication(input: {
    organizationId: string;
    applicationId: string;
    name?: string;
    description?: string | null;
    status?: 'active' | 'suspended';
    rateLimitPerMin?: number;
  }): Promise<ComplianceApplication> {
    const application = await this.requireOwnedApplication(
      input.organizationId,
      input.applicationId,
    );

    if (input.rateLimitPerMin !== undefined) {
      if (
        !Number.isInteger(input.rateLimitPerMin) ||
        input.rateLimitPerMin < 1 ||
        input.rateLimitPerMin > MAX_RATE_LIMIT_PER_MIN
      ) {
        throw new BadRequestException(
          `rateLimitPerMin must be a whole number between 1 and ${MAX_RATE_LIMIT_PER_MIN}`,
        );
      }
    }

    return this.applications.save({
      ...application,
      name: input.name?.trim() || application.name,
      description:
        input.description === undefined
          ? application.description
          : input.description?.trim() || null,
      status: input.status ?? application.status,
      rateLimitPerMin: input.rateLimitPerMin ?? application.rateLimitPerMin,
      updatedAt: new Date(),
    });
  }

  async listKeys(
    organizationId: string,
    applicationId: string,
  ): Promise<ApiKeySummary[]> {
    await this.requireOwnedApplication(organizationId, applicationId);
    const keys = await this.keys.findByApplicationId(applicationId);
    return keys.map(toSummary);
  }

  async createKey(input: {
    organizationId: string;
    applicationId: string;
    environment: ConnectionEnvironment;
    name?: string | null;
    scopes?: string[];
    expiresAt?: Date | null;
    createdByUserId?: string | null;
  }): Promise<CreatedApiKey> {
    await this.requireOwnedApplication(
      input.organizationId,
      input.applicationId,
    );

    const environment = parseEnvironment(input.environment);
    const scopes = parseScopes(input.scopes);
    if (input.expiresAt && input.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('expiresAt must be in the future');
    }

    const generated = generateApiKey(environment);
    const now = new Date();
    const saved = await this.keys.save({
      id: randomUUID(),
      applicationId: input.applicationId,
      environment,
      keyPrefix: generated.keyPrefix,
      keyHash: generated.keyHash,
      lastFour: generated.lastFour,
      name: input.name?.trim() || null,
      scopes,
      status: 'active',
      lastUsedAt: null,
      expiresAt: input.expiresAt ?? null,
      createdByUserId: input.createdByUserId ?? null,
      revokedAt: null,
      revokedByUserId: null,
      createdAt: now,
      updatedAt: now,
    });

    return { key: toSummary(saved), plaintext: generated.plaintext };
  }

  /**
   * Issues a replacement and revokes the old key.
   *
   * Not "re-issue the same key with a new secret": the old key keeps its id and
   * its revoked state, so the audit trail still shows what was in use and when
   * it stopped being valid.
   */
  async rotateKey(input: {
    organizationId: string;
    apiKeyId: string;
    rotatedByUserId?: string | null;
  }): Promise<CreatedApiKey> {
    const existing = await this.requireOwnedKey(
      input.organizationId,
      input.apiKeyId,
    );

    const created = await this.createKey({
      organizationId: input.organizationId,
      applicationId: existing.applicationId,
      environment: existing.environment,
      name: existing.name,
      scopes: existing.scopes,
      expiresAt: existing.expiresAt,
      createdByUserId: input.rotatedByUserId ?? null,
    });

    await this.revokeKey({
      organizationId: input.organizationId,
      apiKeyId: existing.id,
      revokedByUserId: input.rotatedByUserId ?? null,
    });

    return created;
  }

  async revokeKey(input: {
    organizationId: string;
    apiKeyId: string;
    revokedByUserId?: string | null;
  }): Promise<ApiKeySummary> {
    const existing = await this.requireOwnedKey(
      input.organizationId,
      input.apiKeyId,
    );
    if (existing.status === 'revoked') return toSummary(existing);

    const now = new Date();
    const saved = await this.keys.save({
      ...existing,
      status: 'revoked',
      revokedAt: now,
      revokedByUserId: input.revokedByUserId ?? null,
      updatedAt: now,
    });
    return toSummary(saved);
  }

  private async requireOwnedApplication(
    organizationId: string,
    applicationId: string,
  ): Promise<ComplianceApplication> {
    const application = await this.applications.findById(applicationId);
    if (!application) {
      throw new NotFoundException(`Application ${applicationId} not found`);
    }
    if (application.organizationId !== organizationId) {
      throw new ForbiddenException(
        'This application does not belong to your organization',
      );
    }
    return application;
  }

  private async requireOwnedKey(
    organizationId: string,
    apiKeyId: string,
  ): Promise<ComplianceApiKey> {
    const key = await this.keys.findById(apiKeyId);
    if (!key) {
      throw new NotFoundException(`API key ${apiKeyId} not found`);
    }
    await this.requireOwnedApplication(organizationId, key.applicationId);
    return key;
  }
}

function parseEnvironment(value: unknown): ConnectionEnvironment {
  if (
    value === ConnectionEnvironment.SANDBOX ||
    value === ConnectionEnvironment.PRODUCTION
  ) {
    return value;
  }
  throw new BadRequestException(
    `environment must be ${ConnectionEnvironment.SANDBOX} or ${ConnectionEnvironment.PRODUCTION}`,
  );
}

/**
 * An omitted `scopes` grants all of them: the common case is one integration
 * doing the whole eTIMS flow, and a key that silently had no scopes would fail
 * at the first call with a confusing error. Narrowing is opt-in and explicit.
 */
function parseScopes(scopes: string[] | undefined): ApiKeyScope[] {
  if (scopes === undefined) return [...ALL_API_KEY_SCOPES];
  if (!Array.isArray(scopes)) {
    throw new BadRequestException('scopes must be an array');
  }
  if (scopes.length === 0) {
    throw new BadRequestException(
      'scopes must name at least one scope, or be omitted to grant all',
    );
  }
  const invalid = scopes.filter((s) => !isApiKeyScope(s));
  if (invalid.length > 0) {
    throw new BadRequestException(
      `Unknown scope${invalid.length > 1 ? 's' : ''}: ${invalid.join(', ')}. Valid scopes are ${ALL_API_KEY_SCOPES.join(', ')}.`,
    );
  }
  return [...new Set(scopes as ApiKeyScope[])];
}
