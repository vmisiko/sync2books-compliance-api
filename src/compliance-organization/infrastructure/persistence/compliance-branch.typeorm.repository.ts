import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { IComplianceBranchRepository } from '../../application/ports/compliance-branch.repository.port';
import type { ComplianceBranch } from '../../domain/entities/compliance-branch.entity';
import { ComplianceBranchOrmEntity } from './compliance-branch.orm-entity';

function toDomain(e: ComplianceBranchOrmEntity): ComplianceBranch {
  return {
    id: e.id,
    tenantId: e.tenantId,
    sync2booksBranchId: e.sync2booksBranchId,
    displayName: e.displayName,
    kraBhfId: e.kraBhfId,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

@Injectable()
export class ComplianceBranchTypeOrmRepository implements IComplianceBranchRepository {
  constructor(
    @InjectRepository(ComplianceBranchOrmEntity)
    private readonly repo: Repository<ComplianceBranchOrmEntity>,
  ) {}

  async findById(id: string): Promise<ComplianceBranch | null> {
    const e = await this.repo.findOne({ where: { id } });
    return e ? toDomain(e) : null;
  }

  async findByTenantAndSync2booksBranchId(
    tenantId: string,
    sync2booksBranchId: string,
  ): Promise<ComplianceBranch | null> {
    const e = await this.repo.findOne({
      where: { tenantId, sync2booksBranchId },
    });
    return e ? toDomain(e) : null;
  }

  async listByTenantId(tenantId: string): Promise<ComplianceBranch[]> {
    const rows = await this.repo.find({
      where: { tenantId },
      order: { sync2booksBranchId: 'ASC' },
    });
    return rows.map(toDomain);
  }

  async save(branch: ComplianceBranch): Promise<ComplianceBranch> {
    const e = this.repo.create({
      id: branch.id,
      tenantId: branch.tenantId,
      sync2booksBranchId: branch.sync2booksBranchId,
      displayName: branch.displayName,
      kraBhfId: branch.kraBhfId,
      createdAt: branch.createdAt,
      updatedAt: branch.updatedAt,
    });
    await this.repo.save(e);
    return toDomain(e);
  }
}
