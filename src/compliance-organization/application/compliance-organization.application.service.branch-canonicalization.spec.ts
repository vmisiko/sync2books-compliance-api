import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ComplianceOrganizationModule } from '../compliance-organization.module';
import { ComplianceOrganizationApplicationService } from './compliance-organization.application.service';

/**
 * Regression coverage for the branch-id canonicalization introduced to fix
 * the two-rows-per-branch `inventory_stock` bug: Mode A (main API) forwards
 * `branch.sync2booksBranchId ?? branch.id` (often `'00'`), Mode B (dashboard)
 * sends `branch.id` directly, and both must resolve to the same canonical id
 * so a single writer (InventoryService.toCanonicalBranchId) can normalize
 * every stock/movement write onto one row per item+branch.
 */
describe('ComplianceOrganizationApplicationService branch-id canonicalization', () => {
  let service: ComplianceOrganizationApplicationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'sqljs',
          autoSave: false,
          autoLoadEntities: true,
          synchronize: true,
          logging: false,
        }),
        ComplianceOrganizationModule,
      ],
    }).compile();

    await module.init();
    service = module.get(ComplianceOrganizationApplicationService);
  });

  describe('resolveDefaultBranchId', () => {
    it("returns the canonical id (ComplianceBranch.id), never the tenant's sync2booksBranchId alias", async () => {
      const { tenant, defaultBranchId } = await service.upsertTenant({
        sync2booksCompanyId: 'merchant-default',
      });
      await service.upsertBranch({
        tenantId: tenant.id,
        id: defaultBranchId,
        sync2booksBranchId: '00',
      });

      const resolved = await service.resolveDefaultBranchId(tenant.id);
      expect(resolved).toBe(defaultBranchId);
      expect(resolved).not.toBe('00');
    });

    it('returns null for a tenant with no branch at all', async () => {
      expect(await service.resolveDefaultBranchId('no-such-tenant')).toBeNull();
    });
  });

  describe('resolveCanonicalBranchId', () => {
    it('resolves the canonical id unchanged when already canonical', async () => {
      const { tenant, defaultBranchId } = await service.upsertTenant({
        sync2booksCompanyId: 'merchant-canonical',
      });
      await service.upsertBranch({
        tenantId: tenant.id,
        id: defaultBranchId,
        sync2booksBranchId: '00',
      });

      expect(
        await service.resolveCanonicalBranchId(tenant.id, defaultBranchId),
      ).toBe(defaultBranchId);
    });

    it('resolves the sync2booksBranchId alias (e.g. "00") to the canonical id', async () => {
      const { tenant, defaultBranchId } = await service.upsertTenant({
        sync2booksCompanyId: 'merchant-alias',
      });
      await service.upsertBranch({
        tenantId: tenant.id,
        id: defaultBranchId,
        sync2booksBranchId: '00',
      });

      expect(await service.resolveCanonicalBranchId(tenant.id, '00')).toBe(
        defaultBranchId,
      );
    });

    it('returns null when the branch id matches nothing for that tenant', async () => {
      const { tenant, defaultBranchId } = await service.upsertTenant({
        sync2booksCompanyId: 'merchant-unmatched',
      });
      await service.upsertBranch({
        tenantId: tenant.id,
        id: defaultBranchId,
        sync2booksBranchId: '00',
      });

      expect(
        await service.resolveCanonicalBranchId(tenant.id, 'not-a-branch'),
      ).toBeNull();
    });

    /**
     * `sync2booksBranchId` is unique only per tenant (most tenants use '00'
     * for their HQ branch), so resolution must be scoped to the caller's own
     * tenant -- looking it up globally would hand back a *different*
     * tenant's branch for the same alias, silently redirecting a stock write
     * to the wrong tenant's row.
     */
    it("scopes resolution to the given tenant -- one tenant's '00' never resolves against another tenant's branch", async () => {
      const tenantA = await service.upsertTenant({
        sync2booksCompanyId: 'merchant-a',
      });
      await service.upsertBranch({
        tenantId: tenantA.tenant.id,
        id: tenantA.defaultBranchId,
        sync2booksBranchId: '00',
      });

      const tenantB = await service.upsertTenant({
        sync2booksCompanyId: 'merchant-b',
      });
      await service.upsertBranch({
        tenantId: tenantB.tenant.id,
        id: tenantB.defaultBranchId,
        sync2booksBranchId: '00',
      });

      const resolvedForA = await service.resolveCanonicalBranchId(
        tenantA.tenant.id,
        '00',
      );
      const resolvedForB = await service.resolveCanonicalBranchId(
        tenantB.tenant.id,
        '00',
      );

      expect(resolvedForA).toBe(tenantA.defaultBranchId);
      expect(resolvedForB).toBe(tenantB.defaultBranchId);
      expect(resolvedForA).not.toBe(resolvedForB);
    });
  });

  describe('resolveCanonicalBranchIdForMerchant', () => {
    it('resolves via the sync2books companyId carried as merchantId on compliance-owned rows', async () => {
      const { tenant, defaultBranchId } = await service.upsertTenant({
        sync2booksCompanyId: 'merchant-via-id',
      });
      await service.upsertBranch({
        tenantId: tenant.id,
        id: defaultBranchId,
        sync2booksBranchId: '00',
      });

      expect(
        await service.resolveCanonicalBranchIdForMerchant(
          'merchant-via-id',
          '00',
        ),
      ).toBe(defaultBranchId);
    });

    it('returns null for an unprovisioned merchant rather than throwing', async () => {
      expect(
        await service.resolveCanonicalBranchIdForMerchant(
          'merchant-unprovisioned',
          '00',
        ),
      ).toBeNull();
    });
  });
});
