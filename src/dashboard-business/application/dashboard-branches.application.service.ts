import { Injectable, Logger } from '@nestjs/common';
import { ComplianceOrganizationApplicationService } from '../../compliance-organization/application/compliance-organization.application.service';
import type { ComplianceBranch } from '../../compliance-organization/domain/entities/compliance-branch.entity';
import { MainApiConnectionApplicationService } from '../../integration/main-api-pull/application/main-api-connection.application.service';
import { OscuOperationsService } from '../../regulatory/oscu/presentation/oscu-operations.service';

/**
 * One branch as KRA reports it in `branchList` (OSCU spec §3.3.4.1). Only
 * `bhfId`/`bhfNm` are persisted today -- the rest is returned to the caller so
 * the dashboard can show what KRA actually holds without us guessing which
 * fields matter enough to add columns for.
 */
export type EtimsBranch = {
  bhfId: string;
  bhfNm: string | null;
  bhfSttsCd: string | null;
  prvncNm: string | null;
  dstrtNm: string | null;
  sctrNm: string | null;
  locDesc: string | null;
  mgrNm: string | null;
  mgrTelNo: string | null;
  mgrEmail: string | null;
  /** 'Y' for the headquarter branch (normally bhfId '00'). */
  hqYn: string | null;
};

export type PullBranchesResult = {
  branches: ComplianceBranch[];
  fetched: number;
  created: number;
  updated: number;
  /** Straight from KRA, unpersisted fields included. */
  etimsBranches: EtimsBranch[];
};

function str(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number') return String(value);
  return null;
}

/**
 * KRA returns `{ data: { bhfList: [...] } }`. The Slade360 adapter proxies its
 * own organisation-branches endpoint instead and its response shape isn't
 * confirmed (see EtimsAdapterSlade360's header comment), so rather than guess
 * at its field names we accept any of the obvious envelope positions and
 * require only that the entries look like branches (they carry a `bhfId`).
 */
function extractBhfList(raw: Record<string, unknown> | undefined): unknown[] {
  if (!raw) return [];
  const data = raw['data'];
  const candidates: unknown[] = [
    typeof data === 'object' && data !== null
      ? (data as Record<string, unknown>)['bhfList']
      : undefined,
    raw['bhfList'],
    typeof data === 'object' && data !== null
      ? (data as Record<string, unknown>)['results']
      : undefined,
    raw['results'],
    data,
    raw,
  ];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    const entries = candidate.filter(
      (entry): entry is Record<string, unknown> =>
        typeof entry === 'object' && entry !== null && 'bhfId' in entry,
    );
    if (entries.length > 0) return entries;
  }
  return [];
}

function toEtimsBranch(entry: Record<string, unknown>): EtimsBranch | null {
  const bhfId = str(entry['bhfId']);
  if (!bhfId) return null;
  return {
    bhfId,
    bhfNm: str(entry['bhfNm']),
    bhfSttsCd: str(entry['bhfSttsCd']),
    prvncNm: str(entry['prvncNm']),
    dstrtNm: str(entry['dstrtNm']),
    sctrNm: str(entry['sctrNm']),
    locDesc: str(entry['locDesc']),
    mgrNm: str(entry['mgrNm']),
    mgrTelNo: str(entry['mgrTelNo']),
    mgrEmail: str(entry['mgrEmail']),
    hqYn: str(entry['hqYn']),
  };
}

/**
 * Pulls a business's real branch list from KRA instead of leaving the
 * dashboard to hardcode branch names.
 *
 * Chicken-and-egg worth knowing about: `branchList` is itself an authenticated
 * OSCU call, so it can only run once *one* branch (in practice HQ, `bhfId`
 * '00') already has an initialized eTIMS connection. The pull then discovers
 * the rest. A discovered branch is a reporting/filtering entity only until
 * someone initializes a device for it -- it has no `cmcKey`/`deviceId` of its
 * own and cannot submit.
 */
@Injectable()
export class DashboardBranchesApplicationService {
  private readonly logger = new Logger(DashboardBranchesApplicationService.name);

  constructor(
    private readonly organization: ComplianceOrganizationApplicationService,
    private readonly mainApiConnections: MainApiConnectionApplicationService,
    private readonly oscu: OscuOperationsService,
  ) {}

  async list(tenantId: string): Promise<ComplianceBranch[]> {
    return this.organization.listBranches(tenantId);
  }

  async pullFromEtims(tenantId: string): Promise<PullBranchesResult> {
    const merchantId = await this.mainApiConnections.resolveMerchantId(tenantId);
    const branchId = await this.organization.resolveDashboardBranchId(tenantId);

    const envelope = await this.oscu.branchList(merchantId, branchId);
    const entries = extractBhfList(envelope.rawResponse);
    const etimsBranches = entries
      .map((entry) => toEtimsBranch(entry as Record<string, unknown>))
      .filter((branch): branch is EtimsBranch => branch !== null);

    if (etimsBranches.length === 0) {
      // resultCd '001' ("no result") is a legitimate lookup outcome, so an
      // empty list is not an error -- report it rather than throwing.
      this.logger.warn(
        `branchList returned no branches for tenant=${tenantId} merchant=${merchantId}`,
      );
      return {
        branches: await this.organization.listBranches(tenantId),
        fetched: 0,
        created: 0,
        updated: 0,
        etimsBranches: [],
      };
    }

    const before = await this.organization.listBranches(tenantId);
    const knownBhfIds = new Set(
      before.map((b) => b.kraBhfId).filter((id): id is string => !!id),
    );

    let created = 0;
    let updated = 0;
    for (const branch of etimsBranches) {
      if (knownBhfIds.has(branch.bhfId)) updated += 1;
      else created += 1;
      await this.organization.upsertBranch({
        tenantId,
        kraBhfId: branch.bhfId,
        displayName: branch.bhfNm ?? `Branch ${branch.bhfId}`,
      });
    }

    return {
      branches: await this.organization.listBranches(tenantId),
      fetched: etimsBranches.length,
      created,
      updated,
      etimsBranches,
    };
  }
}
