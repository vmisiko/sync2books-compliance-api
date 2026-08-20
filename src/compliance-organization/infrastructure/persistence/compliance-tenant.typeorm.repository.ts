import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { IComplianceTenantRepository } from '../../application/ports/compliance-tenant.repository.port';
import type { ComplianceTenant } from '../../domain/entities/compliance-tenant.entity';
import { ComplianceTenantOrmEntity } from './compliance-tenant.orm-entity';

function toDomain(e: ComplianceTenantOrmEntity): ComplianceTenant {
  return {
    id: e.id,
    sync2booksCompanyId: e.sync2booksCompanyId,
    displayName: e.displayName,
    organizationId: e.organizationId,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

@Injectable()
export class ComplianceTenantTypeOrmRepository implements IComplianceTenantRepository {
  constructor(
    @InjectRepository(ComplianceTenantOrmEntity)
    private readonly repo: Repository<ComplianceTenantOrmEntity>,
  ) {}

  async findById(id: string): Promise<ComplianceTenant | null> {
    const e = await this.repo.findOne({ where: { id } });
    return e ? toDomain(e) : null;
  }

  async findBySync2booksCompanyId(
    sync2booksCompanyId: string,
  ): Promise<ComplianceTenant | null> {
    const e = await this.repo.findOne({ where: { sync2booksCompanyId } });
    return e ? toDomain(e) : null;
  }

  async findByOrganizationId(organizationId: string): Promise<ComplianceTenant[]> {
    const rows = await this.repo.find({ where: { organizationId } });
    return rows.map(toDomain);
  }

  async save(tenant: ComplianceTenant): Promise<ComplianceTenant> {
    const e = this.repo.create({
      id: tenant.id,
      sync2booksCompanyId: tenant.sync2booksCompanyId ?? null,
      displayName: tenant.displayName,
      organizationId: tenant.organizationId ?? null,
      createdAt: tenant.createdAt,
      updatedAt: tenant.updatedAt,
    });
    await this.repo.save(e);
    return toDomain(e);
  }
}
