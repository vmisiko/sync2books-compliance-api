import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { ComplianceConnection } from '../../../shared/domain/entities/compliance-connection.entity';
import { ConnectionEnvironment } from '../../../shared/domain/enums/connection-environment.enum';
import { ConnectionStatus } from '../../../shared/domain/enums/connection-status.enum';
import type { IComplianceConnectionRepository } from '../../../shared/ports/repository.port';
import { ComplianceBranchOrmEntity } from './compliance-branch.orm-entity';
import { ComplianceEtimsConnectionOrmEntity } from './compliance-etims-connection.orm-entity';
import { ComplianceTenantOrmEntity } from './compliance-tenant.orm-entity';

function toDomain(
  conn: ComplianceEtimsConnectionOrmEntity,
  tenant: ComplianceTenantOrmEntity,
  branch: ComplianceBranchOrmEntity,
): ComplianceConnection {
  return {
    id: conn.id,
    merchantId: tenant.sync2booksCompanyId ?? tenant.id,
    branchId: branch.sync2booksBranchId ?? branch.id,
    kraBhfId: branch.kraBhfId,
    kraPin: conn.kraPin,
    deviceId: conn.deviceId,
    dvcSrlNo: conn.dvcSrlNo,
    environment: conn.environment as ConnectionEnvironment,
    status: conn.status as ConnectionStatus,
    cmcKey: conn.cmcKey,
    lastCodeSyncAt: conn.lastCodeSyncAt,
    createdAt: conn.createdAt,
    updatedAt: conn.updatedAt,
  };
}

/** When `deviceId` / `cmcKey` are omitted, create uses placeholders; update leaves existing OSCU secrets unchanged. */
export type UpsertEtimsConnectionInput = {
  complianceBranchId: string;
  kraPin: string;
  deviceId?: string;
  cmcKey?: string;
  dvcSrlNo?: string | null;
  environment: ConnectionEnvironment;
  status: ConnectionStatus;
  sync2booksConnectionId?: string | null;
  lastCodeSyncAt?: Date | null;
};

const PENDING_DEVICE_ID = 'pending';
const PENDING_CMC_KEY = '';

@Injectable()
export class ComplianceOrganizationConnectionTypeOrmRepository implements IComplianceConnectionRepository {
  constructor(
    @InjectRepository(ComplianceEtimsConnectionOrmEntity)
    private readonly connRepo: Repository<ComplianceEtimsConnectionOrmEntity>,
    @InjectRepository(ComplianceBranchOrmEntity)
    private readonly branchRepo: Repository<ComplianceBranchOrmEntity>,
    @InjectRepository(ComplianceTenantOrmEntity)
    private readonly tenantRepo: Repository<ComplianceTenantOrmEntity>,
  ) {}

  async findBranchTenantEtimsByBranchId(branchId: string): Promise<{
    tenant: ComplianceTenantOrmEntity;
    branch: ComplianceBranchOrmEntity;
    etims: ComplianceEtimsConnectionOrmEntity | null;
  } | null> {
    const branch = await this.branchRepo.findOne({
      where: { id: branchId },
      relations: ['tenant', 'etimsConnection'],
    });
    if (!branch?.tenant) return null;
    return {
      tenant: branch.tenant,
      branch,
      etims: branch.etimsConnection ?? null,
    };
  }

  async findByMerchantAndBranch(
    merchantId: string,
    branchId: string,
  ): Promise<ComplianceConnection | null> {
    const tenant = await this.tenantRepo.findOne({
      where: { sync2booksCompanyId: merchantId },
    });
    if (!tenant) return null;
    // `branchId` is `branch.sync2booksBranchId ?? branch.id` wherever we hand
    // it out (see toDomain above and compliance-organization.application
    // .service.ts's getTenantSummary) -- match on either column so a
    // dashboard-only branch (sync2booksBranchId null, no ERP link) resolves
    // by its own id instead of never matching anything.
    const branch = await this.branchRepo.findOne({
      where: [
        { tenantId: tenant.id, sync2booksBranchId: branchId },
        { tenantId: tenant.id, id: branchId },
      ],
      relations: ['etimsConnection'],
    });
    if (!branch?.etimsConnection) return null;
    return toDomain(branch.etimsConnection, tenant, branch);
  }

  async upsertEtimsConnection(
    input: UpsertEtimsConnectionInput,
  ): Promise<ComplianceConnection> {
    const branch = await this.branchRepo.findOne({
      where: { id: input.complianceBranchId },
      relations: ['tenant', 'etimsConnection'],
    });
    if (!branch?.tenant) {
      throw new Error(`Branch ${input.complianceBranchId} not found`);
    }
    const now = new Date();
    let row = branch.etimsConnection;
    if (!row) {
      const created = this.connRepo.create({
        id: randomUUID(),
        kraPin: input.kraPin,
        deviceId: input.deviceId ?? PENDING_DEVICE_ID,
        dvcSrlNo: input.dvcSrlNo ?? null,
        cmcKey: input.cmcKey ?? PENDING_CMC_KEY,
        environment: input.environment,
        status: input.status,
        sync2booksConnectionId: input.sync2booksConnectionId ?? null,
        lastCodeSyncAt: input.lastCodeSyncAt ?? null,
        createdAt: now,
        updatedAt: now,
      });
      created.branch = branch;
      row = created;
    } else {
      row.kraPin = input.kraPin;
      if (input.deviceId !== undefined) {
        row.deviceId = input.deviceId;
      }
      if (input.cmcKey !== undefined) {
        row.cmcKey = input.cmcKey;
      }
      if (input.dvcSrlNo !== undefined) {
        row.dvcSrlNo = input.dvcSrlNo;
      }
      row.environment = input.environment;
      row.status = input.status;
      row.sync2booksConnectionId =
        input.sync2booksConnectionId ?? row.sync2booksConnectionId;
      if (input.lastCodeSyncAt !== undefined) {
        row.lastCodeSyncAt = input.lastCodeSyncAt;
      }
      row.updatedAt = now;
    }
    await this.connRepo.save(row);
    return toDomain(row, branch.tenant, branch);
  }
}
