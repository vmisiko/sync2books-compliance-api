import { randomUUID } from 'crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ComplianceBranch } from '../domain/entities/compliance-branch.entity';
import type { ComplianceTenant } from '../domain/entities/compliance-tenant.entity';
import { ComplianceBranchTypeOrmRepository } from '../infrastructure/persistence/compliance-branch.typeorm.repository';
import { ComplianceOrganizationConnectionTypeOrmRepository } from '../infrastructure/persistence/compliance-organization-connection.typeorm.repository';
import { ComplianceTenantTypeOrmRepository } from '../infrastructure/persistence/compliance-tenant.typeorm.repository';
import { ConnectionEnvironment } from '../../shared/domain/enums/connection-environment.enum';
import { ConnectionStatus } from '../../shared/domain/enums/connection-status.enum';
import type { ComplianceConnection } from '../../shared/domain/entities/compliance-connection.entity';
import type {
  EtimsConnectionContext,
  IEtimsAdapter,
} from '../../regulatory/oscu/ports/etims-adapter.port';
import { ETIMS_ADAPTER } from '../../shared/tokens';
import { parseOscuInitializeDeviceInfo } from './parse-oscu-initialize-device';

/** Trims; empty string becomes null. `undefined` means caller omitted the field. */
function trimExternalId(
  v: string | null | undefined,
): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const t = v.trim();
  return t === '' ? null : t;
}

export type UpsertTenantInput = {
  /** Update an existing tenant (e.g. dashboard-only row) by internal id. */
  id?: string | null;
  sync2booksCompanyId?: string | null;
  displayName?: string | null;
};

export type UpsertBranchInput = {
  tenantId: string;
  id?: string | null;
  sync2booksBranchId?: string | null;
  displayName?: string | null;
  kraBhfId?: string | null;
};

export type UpsertEtimsConnectionInput = {
  complianceBranchId: string;
  kraPin: string;
  environment: ConnectionEnvironment;
  /** Device serial for OSCU initialize; not OSCU `dvcId` (that is set only after initialize). */
  dvcSrlNo?: string | null;
  status?: ConnectionStatus;
  sync2booksConnectionId?: string | null;
  /**
   * OSCU `dvcId` and CMC key are never accepted from the public PUT body.
   * Optional here for {@link initializeEtimsConnection} and internal seed only.
   */
  deviceId?: string;
  cmcKey?: string;
};

export type InitializeEtimsConnectionInput = {
  complianceBranchId: string;
  /** Overrides stored `dvcSrlNo` on the connection for this call and persistence. */
  dvcSrlNo?: string | null;
};

@Injectable()
export class ComplianceOrganizationApplicationService {
  constructor(
    private readonly tenantRepo: ComplianceTenantTypeOrmRepository,
    private readonly branchRepo: ComplianceBranchTypeOrmRepository,
    private readonly orgConnectionRepo: ComplianceOrganizationConnectionTypeOrmRepository,
    @Inject(ETIMS_ADAPTER) private readonly etimsAdapter: IEtimsAdapter,
  ) {}

  async upsertTenant(input: UpsertTenantInput): Promise<ComplianceTenant> {
    const companyId = trimExternalId(input.sync2booksCompanyId);
    const now = new Date();

    if (input.id) {
      const existing = await this.tenantRepo.findById(input.id);
      if (!existing) {
        throw new NotFoundException(`Tenant ${input.id} not found`);
      }
      const updated: ComplianceTenant = {
        ...existing,
        sync2booksCompanyId:
          companyId === undefined ? existing.sync2booksCompanyId : companyId,
        displayName: input.displayName ?? existing.displayName,
        updatedAt: now,
      };
      return this.tenantRepo.save(updated);
    }

    if (companyId) {
      const existing =
        await this.tenantRepo.findBySync2booksCompanyId(companyId);
      if (existing) {
        const updated: ComplianceTenant = {
          ...existing,
          displayName: input.displayName ?? existing.displayName,
          updatedAt: now,
        };
        return this.tenantRepo.save(updated);
      }
    }

    const tenant: ComplianceTenant = {
      id: randomUUID(),
      sync2booksCompanyId: companyId ?? null,
      displayName: input.displayName ?? null,
      createdAt: now,
      updatedAt: now,
    };
    return this.tenantRepo.save(tenant);
  }

  async getTenantBySync2booksCompanyId(
    sync2booksCompanyId: string,
  ): Promise<ComplianceTenant | null> {
    return this.tenantRepo.findBySync2booksCompanyId(sync2booksCompanyId);
  }

  async getTenantById(tenantId: string): Promise<ComplianceTenant | null> {
    return this.tenantRepo.findById(tenantId);
  }

  async upsertBranch(input: UpsertBranchInput): Promise<ComplianceBranch> {
    const tenant = await this.tenantRepo.findById(input.tenantId);
    if (!tenant) {
      throw new NotFoundException(`Tenant ${input.tenantId} not found`);
    }
    const branchKey = trimExternalId(input.sync2booksBranchId);
    const now = new Date();

    if (input.id) {
      const existing = await this.branchRepo.findById(input.id);
      if (!existing || existing.tenantId !== input.tenantId) {
        throw new NotFoundException(`Branch ${input.id} not found`);
      }
      const updated: ComplianceBranch = {
        ...existing,
        sync2booksBranchId:
          branchKey === undefined ? existing.sync2booksBranchId : branchKey,
        displayName: input.displayName ?? existing.displayName,
        kraBhfId: input.kraBhfId ?? existing.kraBhfId,
        updatedAt: now,
      };
      return this.branchRepo.save(updated);
    }

    if (branchKey) {
      const existing = await this.branchRepo.findByTenantAndSync2booksBranchId(
        input.tenantId,
        branchKey,
      );
      if (existing) {
        const updated: ComplianceBranch = {
          ...existing,
          displayName: input.displayName ?? existing.displayName,
          kraBhfId: input.kraBhfId ?? existing.kraBhfId,
          updatedAt: now,
        };
        return this.branchRepo.save(updated);
      }
    }

    const branch: ComplianceBranch = {
      id: randomUUID(),
      tenantId: input.tenantId,
      sync2booksBranchId: branchKey ?? null,
      displayName: input.displayName ?? null,
      kraBhfId: input.kraBhfId ?? null,
      createdAt: now,
      updatedAt: now,
    };
    return this.branchRepo.save(branch);
  }

  async listBranches(tenantId: string): Promise<ComplianceBranch[]> {
    return this.branchRepo.listByTenantId(tenantId);
  }

  async getBranchById(branchId: string): Promise<ComplianceBranch | null> {
    return this.branchRepo.findById(branchId);
  }

  async upsertEtimsConnection(
    input: UpsertEtimsConnectionInput,
  ): Promise<ComplianceConnection> {
    return this.orgConnectionRepo.upsertEtimsConnection({
      complianceBranchId: input.complianceBranchId,
      kraPin: input.kraPin,
      deviceId: input.deviceId,
      cmcKey: input.cmcKey,
      dvcSrlNo: input.dvcSrlNo,
      environment: input.environment,
      status: input.status ?? ConnectionStatus.ACTIVE,
      sync2booksConnectionId: input.sync2booksConnectionId ?? null,
    });
  }

  /**
   * Calls OSCU initialize with `{ tin, bhfId, dvcSrlNo }`, then persists `cmcKey` and OSCU `dvcId` as {@link UpsertEtimsConnectionInput.deviceId}.
   * Requires branch {@link ComplianceBranch.kraBhfId} and an existing eTIMS connection row (use PUT .../etims-connection first).
   */
  async initializeEtimsConnection(
    input: InitializeEtimsConnectionInput,
  ): Promise<ComplianceConnection> {
    const found = await this.orgConnectionRepo.findBranchTenantEtimsByBranchId(
      input.complianceBranchId,
    );
    if (!found) {
      throw new NotFoundException(
        `Branch ${input.complianceBranchId} not found`,
      );
    }
    const { tenant, branch, etims } = found;
    if (!branch.kraBhfId) {
      throw new BadRequestException(
        'Branch kraBhfId is required before ETIMS initialize (KRA office id)',
      );
    }
    if (!etims) {
      throw new BadRequestException(
        'Create an eTIMS connection first (PUT .../branches/:branchId/etims-connection)',
      );
    }
    const dvcSrlNo = input.dvcSrlNo ?? etims.dvcSrlNo;
    if (!dvcSrlNo || dvcSrlNo.trim() === '') {
      throw new BadRequestException(
        'dvcSrlNo is required (device serial for initialize). Set it on the connection or pass in the request body.',
      );
    }

    const env: EtimsConnectionContext['environment'] =
      (etims.environment as ConnectionEnvironment) ===
      ConnectionEnvironment.PRODUCTION
        ? 'PRODUCTION'
        : 'SANDBOX';

    const ctx: EtimsConnectionContext = {
      merchantId: tenant.sync2booksCompanyId ?? tenant.id,
      branchId: branch.kraBhfId,
      kraPin: etims.kraPin,
      environment: env,
      cmcKey: etims.cmcKey || '',
      deviceId: etims.deviceId || dvcSrlNo,
    };

    const body: Record<string, unknown> = {
      tin: etims.kraPin,
      bhfId: branch.kraBhfId,
      dvcSrlNo,
    };

    const envelope = await this.etimsAdapter.initializeOscu(body, ctx);
    if (!envelope.success || !envelope.rawResponse) {
      throw new BadRequestException(
        envelope.error ?? 'ETIMS initialize failed',
      );
    }

    const parsed = parseOscuInitializeDeviceInfo(envelope.rawResponse);
    if (!parsed) {
      throw new BadRequestException(
        'ETIMS initialize response did not include data.info (cmcKey, dvcId)',
      );
    }

    return this.orgConnectionRepo.upsertEtimsConnection({
      complianceBranchId: input.complianceBranchId,
      kraPin: etims.kraPin,
      deviceId: parsed.dvcId,
      cmcKey: parsed.cmcKey,
      dvcSrlNo,
      environment: etims.environment as ConnectionEnvironment,
      status: ConnectionStatus.ACTIVE,
      sync2booksConnectionId: etims.sync2booksConnectionId,
    });
  }
}
