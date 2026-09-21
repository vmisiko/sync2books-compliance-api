import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConnectionEnvironment } from '../../shared/domain/enums/connection-environment.enum';
import { hashApiKey, looksLikeApiKey } from '../domain/api-key';
import { ALL_API_KEY_SCOPES, ApiKeyScope } from '../domain/api-key-scope.enum';
import type { ComplianceApiKey } from '../domain/entities/compliance-api-key.entity';
import type { ComplianceApplication } from '../domain/entities/compliance-application.entity';
import {
  DEFAULT_RATE_LIMIT_PER_MIN,
  DeveloperPlatformApplicationService,
} from './developer-platform.application.service';
import type { IComplianceApiKeyRepository } from './ports/compliance-api-key.repository.port';
import type { IComplianceApplicationRepository } from './ports/compliance-application.repository.port';

function inMemoryRepos(seed: ComplianceApplication[] = []) {
  const apps = new Map(seed.map((a) => [a.id, a]));
  const keys = new Map<string, ComplianceApiKey>();

  const applications: IComplianceApplicationRepository = {
    findById: async (id) => apps.get(id) ?? null,
    findByOrganizationId: async (organizationId) =>
      [...apps.values()].filter((a) => a.organizationId === organizationId),
    save: async (application) => {
      apps.set(application.id, application);
      return application;
    },
    delete: async (id) => {
      apps.delete(id);
    },
  };

  const apiKeys: IComplianceApiKeyRepository = {
    findByHash: async (keyHash) =>
      [...keys.values()].find((k) => k.keyHash === keyHash) ?? null,
    findById: async (id) => keys.get(id) ?? null,
    findByApplicationId: async (applicationId) =>
      [...keys.values()].filter((k) => k.applicationId === applicationId),
    save: async (key) => {
      keys.set(key.id, key);
      return key;
    },
    touchLastUsedAt: async () => undefined,
  };

  return { applications, apiKeys, apps, keys };
}

function application(
  overrides: Partial<ComplianceApplication> = {},
): ComplianceApplication {
  return {
    id: 'app-1',
    organizationId: 'org-1',
    name: 'Warehouse POS',
    description: null,
    status: 'active',
    rateLimitPerMin: DEFAULT_RATE_LIMIT_PER_MIN,
    createdByUserId: 'user-1',
    createdAt: new Date('2026-09-01'),
    updatedAt: new Date('2026-09-01'),
    ...overrides,
  };
}

function serviceWith(seed: ComplianceApplication[] = [application()]) {
  const repos = inMemoryRepos(seed);
  return {
    service: new DeveloperPlatformApplicationService(
      repos.applications,
      repos.apiKeys,
    ),
    ...repos,
  };
}

describe('DeveloperPlatformApplicationService', () => {
  describe('applications', () => {
    it('creates an application owned by the caller’s organization', async () => {
      const { service } = serviceWith([]);
      const created = await service.createApplication({
        organizationId: 'org-1',
        name: '  Warehouse POS  ',
        createdByUserId: 'user-1',
      });

      expect(created.organizationId).toBe('org-1');
      expect(created.name).toBe('Warehouse POS');
      expect(created.status).toBe('active');
      expect(created.rateLimitPerMin).toBe(DEFAULT_RATE_LIMIT_PER_MIN);
    });

    it('rejects a blank name', async () => {
      const { service } = serviceWith([]);
      await expect(
        service.createApplication({ organizationId: 'org-1', name: '   ' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('lists only the caller’s own applications', async () => {
      const { service } = serviceWith([
        application(),
        application({ id: 'app-2', organizationId: 'org-2' }),
      ]);
      const listed = await service.listApplications('org-1');
      expect(listed.map((a) => a.id)).toEqual(['app-1']);
    });

    it("refuses to update another organization's application", async () => {
      const { service } = serviceWith([
        application({ id: 'app-2', organizationId: 'org-2' }),
      ]);
      await expect(
        service.updateApplication({
          organizationId: 'org-1',
          applicationId: 'app-2',
          name: 'Mine now',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('404s an application that does not exist', async () => {
      const { service } = serviceWith([]);
      await expect(
        service.updateApplication({
          organizationId: 'org-1',
          applicationId: 'nope',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it.each([[0], [-1], [1.5], [6001]])(
      'rejects a rate limit of %p',
      async (rateLimitPerMin) => {
        const { service } = serviceWith();
        await expect(
          service.updateApplication({
            organizationId: 'org-1',
            applicationId: 'app-1',
            rateLimitPerMin,
          }),
        ).rejects.toThrow(BadRequestException);
      },
    );

    it('suspends an application', async () => {
      const { service } = serviceWith();
      const updated = await service.updateApplication({
        organizationId: 'org-1',
        applicationId: 'app-1',
        status: 'suspended',
      });
      expect(updated.status).toBe('suspended');
    });
  });

  describe('keys', () => {
    it('returns the secret exactly once, and never stores it', async () => {
      const { service, keys } = serviceWith();
      const created = await service.createKey({
        organizationId: 'org-1',
        applicationId: 'app-1',
        environment: ConnectionEnvironment.SANDBOX,
      });

      expect(looksLikeApiKey(created.plaintext)).toBe(true);
      const stored = keys.get(created.key.id)!;
      expect(stored.keyHash).toBe(hashApiKey(created.plaintext));
      expect(JSON.stringify(stored)).not.toContain(created.plaintext);

      // Listing it back must not reveal even the hash.
      const listed = await service.listKeys('org-1', 'app-1');
      expect(listed[0]).not.toHaveProperty('keyHash');
      expect(listed[0].keyPrefix).toBe(created.key.keyPrefix);
    });

    it('grants every scope when none are named', async () => {
      const { service } = serviceWith();
      const created = await service.createKey({
        organizationId: 'org-1',
        applicationId: 'app-1',
        environment: ConnectionEnvironment.SANDBOX,
      });
      expect(created.key.scopes).toEqual(ALL_API_KEY_SCOPES);
    });

    it('narrows to the scopes named, without duplicates', async () => {
      const { service } = serviceWith();
      const created = await service.createKey({
        organizationId: 'org-1',
        applicationId: 'app-1',
        environment: ConnectionEnvironment.SANDBOX,
        scopes: [ApiKeyScope.SALES_WRITE, ApiKeyScope.SALES_WRITE],
      });
      expect(created.key.scopes).toEqual([ApiKeyScope.SALES_WRITE]);
    });

    it('rejects an unknown scope rather than silently dropping it', async () => {
      const { service } = serviceWith();
      await expect(
        service.createKey({
          organizationId: 'org-1',
          applicationId: 'app-1',
          environment: ConnectionEnvironment.SANDBOX,
          scopes: ['sales:write', 'everything:always'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an empty scope list, which would be a key that can do nothing', async () => {
      const { service } = serviceWith();
      await expect(
        service.createKey({
          organizationId: 'org-1',
          applicationId: 'app-1',
          environment: ConnectionEnvironment.SANDBOX,
          scopes: [],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an unknown environment', async () => {
      const { service } = serviceWith();
      await expect(
        service.createKey({
          organizationId: 'org-1',
          applicationId: 'app-1',
          environment: 'STAGING' as never,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an expiry in the past', async () => {
      const { service } = serviceWith();
      await expect(
        service.createKey({
          organizationId: 'org-1',
          applicationId: 'app-1',
          environment: ConnectionEnvironment.SANDBOX,
          expiresAt: new Date(Date.now() - 1000),
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("refuses to issue a key on another organization's application", async () => {
      const { service } = serviceWith([
        application({ id: 'app-2', organizationId: 'org-2' }),
      ]);
      await expect(
        service.createKey({
          organizationId: 'org-1',
          applicationId: 'app-2',
          environment: ConnectionEnvironment.SANDBOX,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("refuses to list another organization's keys", async () => {
      const { service } = serviceWith([
        application({ id: 'app-2', organizationId: 'org-2' }),
      ]);
      await expect(service.listKeys('org-1', 'app-2')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('revokes a key', async () => {
      const { service } = serviceWith();
      const created = await service.createKey({
        organizationId: 'org-1',
        applicationId: 'app-1',
        environment: ConnectionEnvironment.SANDBOX,
      });

      const revoked = await service.revokeKey({
        organizationId: 'org-1',
        apiKeyId: created.key.id,
        revokedByUserId: 'user-1',
      });

      expect(revoked.status).toBe('revoked');
      expect(revoked.revokedAt).toBeInstanceOf(Date);
      expect(revoked.revokedByUserId).toBe('user-1');
    });

    it('revoking twice is a no-op, not an error', async () => {
      const { service } = serviceWith();
      const created = await service.createKey({
        organizationId: 'org-1',
        applicationId: 'app-1',
        environment: ConnectionEnvironment.SANDBOX,
      });
      const first = await service.revokeKey({
        organizationId: 'org-1',
        apiKeyId: created.key.id,
      });
      const second = await service.revokeKey({
        organizationId: 'org-1',
        apiKeyId: created.key.id,
      });
      expect(second.revokedAt).toEqual(first.revokedAt);
    });

    it("refuses to revoke another organization's key", async () => {
      const { service } = serviceWith([
        application(),
        application({ id: 'app-2', organizationId: 'org-2' }),
      ]);
      const theirs = await service.createKey({
        organizationId: 'org-2',
        applicationId: 'app-2',
        environment: ConnectionEnvironment.SANDBOX,
      });

      await expect(
        service.revokeKey({ organizationId: 'org-1', apiKeyId: theirs.key.id }),
      ).rejects.toThrow(ForbiddenException);
    });

    // Rotation issues a new key and retires the old one. Reusing the row would
    // erase the record of what was in use and when it stopped being valid.
    it('rotates into a new key and revokes the old one', async () => {
      const { service } = serviceWith();
      const original = await service.createKey({
        organizationId: 'org-1',
        applicationId: 'app-1',
        environment: ConnectionEnvironment.PRODUCTION,
        name: 'Till 1',
        scopes: [ApiKeyScope.SALES_WRITE],
      });

      const rotated = await service.rotateKey({
        organizationId: 'org-1',
        apiKeyId: original.key.id,
        rotatedByUserId: 'user-2',
      });

      expect(rotated.key.id).not.toBe(original.key.id);
      expect(rotated.plaintext).not.toBe(original.plaintext);
      expect(rotated.key.environment).toBe(ConnectionEnvironment.PRODUCTION);
      expect(rotated.key.name).toBe('Till 1');
      expect(rotated.key.scopes).toEqual([ApiKeyScope.SALES_WRITE]);
      expect(rotated.key.status).toBe('active');

      const keys = await service.listKeys('org-1', 'app-1');
      const old = keys.find((k) => k.id === original.key.id)!;
      expect(old.status).toBe('revoked');
      expect(old.revokedByUserId).toBe('user-2');
    });

    it('404s a key that does not exist', async () => {
      const { service } = serviceWith();
      await expect(
        service.revokeKey({ organizationId: 'org-1', apiKeyId: 'nope' }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
