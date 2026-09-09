import { DashboardBranchesApplicationService } from './dashboard-branches.application.service';
import type { ComplianceOrganizationApplicationService } from '../../compliance-organization/application/compliance-organization.application.service';
import type { ComplianceBranch } from '../../compliance-organization/domain/entities/compliance-branch.entity';
import type { MainApiConnectionApplicationService } from '../../integration/main-api-pull/application/main-api-connection.application.service';
import type { OscuOperationsService } from '../../regulatory/oscu/presentation/oscu-operations.service';

const TENANT = 'tenant-1';

/** KRA's own branchList sample (OSCU spec §3.3.4.1), trimmed to two branches. */
const KRA_ENVELOPE = {
  success: true,
  rawResponse: {
    resultCd: '000',
    resultMsg: 'It succeeded',
    data: {
      bhfList: [
        {
          tin: 'A123456789Z',
          bhfId: '00',
          bhfNm: 'Headquater',
          bhfSttsCd: '01',
          prvncNm: 'NAIROBI CITY',
          dstrtNm: 'WESTLANDS',
          sctrNm: 'WON',
          locDesc: 'Westlands Towers',
          mgrNm: 'manage1130_00',
          mgrTelNo: '0789001130',
          mgrEmail: 'manage113000@test.com',
          hqYn: 'Y',
        },
        {
          tin: 'A123456789Z',
          bhfId: '01',
          bhfNm: 'Branch01',
          bhfSttsCd: '01',
          prvncNm: 'NAIROBI CITY',
          dstrtNm: 'WESTLANDS',
          sctrNm: 'WON',
          locDesc: 'Westlands Towers',
          mgrNm: 'manage1130_01',
          mgrTelNo: '0789011130',
          mgrEmail: 'manage113001@test.com',
          hqYn: 'N',
        },
      ],
    },
  },
};

/**
 * Stands in for ComplianceOrganizationApplicationService with the same
 * kraBhfId-keyed upsert behaviour the real one has, so a re-pull here fails
 * the same way a duplicate-row regression would in production.
 */
function fakeOrganization(seed: ComplianceBranch[]) {
  const rows = [...seed];
  return {
    rows,
    listBranches: jest.fn(() => Promise.resolve([...rows])),
    resolveDashboardBranchId: jest.fn(() => Promise.resolve('branch-hq')),
    upsertBranch: jest.fn(
      (input: {
        tenantId: string;
        kraBhfId?: string | null;
        displayName?: string | null;
      }) => {
        const existing = rows.find((r) => r.kraBhfId === input.kraBhfId);
        if (existing) {
          existing.displayName = input.displayName ?? existing.displayName;
          return Promise.resolve(existing);
        }
        const created: ComplianceBranch = {
          id: `branch-${input.kraBhfId}`,
          tenantId: input.tenantId,
          sync2booksBranchId: null,
          displayName: input.displayName ?? null,
          kraBhfId: input.kraBhfId ?? null,
          tradeAddressLine1: null,
          tradeCity: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        rows.push(created);
        return Promise.resolve(created);
      },
    ),
  };
}

function build(
  organization: ReturnType<typeof fakeOrganization>,
  envelope: unknown,
) {
  const oscu = { branchList: jest.fn(() => Promise.resolve(envelope)) };
  const mainApi = {
    resolveMerchantId: jest.fn(() => Promise.resolve('merchant-1')),
  };
  const service = new DashboardBranchesApplicationService(
    organization as unknown as ComplianceOrganizationApplicationService,
    mainApi as unknown as MainApiConnectionApplicationService,
    oscu as unknown as OscuOperationsService,
  );
  return { service, oscu, mainApi };
}

describe('DashboardBranchesApplicationService.pullFromEtims', () => {
  it('creates a branch per KRA bhfList entry and keeps the KRA name', async () => {
    const organization = fakeOrganization([]);
    const { service, oscu } = build(organization, KRA_ENVELOPE);

    const result = await service.pullFromEtims(TENANT);

    expect(oscu.branchList).toHaveBeenCalledWith('merchant-1', 'branch-hq');
    expect(result.fetched).toBe(2);
    expect(result.created).toBe(2);
    expect(result.updated).toBe(0);
    expect(result.branches.map((b) => b.kraBhfId)).toEqual(['00', '01']);
    expect(result.branches.map((b) => b.displayName)).toEqual([
      'Headquater',
      'Branch01',
    ]);
    expect(result.etimsBranches[0].hqYn).toBe('Y');
  });

  it('re-pulls onto the same rows instead of duplicating them', async () => {
    const organization = fakeOrganization([]);
    const { service } = build(organization, KRA_ENVELOPE);

    await service.pullFromEtims(TENANT);
    const second = await service.pullFromEtims(TENANT);

    expect(second.created).toBe(0);
    expect(second.updated).toBe(2);
    expect(organization.rows).toHaveLength(2);
  });

  it('updates the existing connected branch rather than adding a second HQ', async () => {
    const organization = fakeOrganization([
      {
        id: 'branch-hq',
        tenantId: TENANT,
        sync2booksBranchId: 'hq',
        displayName: 'Main Office',
        kraBhfId: '00',
        tradeAddressLine1: null,
        tradeCity: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    const { service } = build(organization, KRA_ENVELOPE);

    const result = await service.pullFromEtims(TENANT);

    expect(result.created).toBe(1);
    expect(result.updated).toBe(1);
    expect(organization.rows).toHaveLength(2);
    // The connected row keeps its identity (and its sync2booksBranchId link).
    expect(organization.rows[0].id).toBe('branch-hq');
    expect(organization.rows[0].sync2booksBranchId).toBe('hq');
  });

  it('reports an empty pull instead of throwing when KRA returns no branches', async () => {
    const organization = fakeOrganization([]);
    const { service } = build(organization, {
      success: true,
      rawResponse: { resultCd: '001', resultMsg: 'No search result' },
    });

    const result = await service.pullFromEtims(TENANT);

    expect(result.fetched).toBe(0);
    expect(result.created).toBe(0);
    expect(organization.upsertBranch).not.toHaveBeenCalled();
  });
});
