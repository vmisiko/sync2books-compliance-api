import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { IComplianceApplicationRepository } from '../../application/ports/compliance-application.repository.port';
import type { ComplianceApplication } from '../../domain/entities/compliance-application.entity';
import { ComplianceApplicationOrmEntity } from './compliance-application.orm-entity';

function toDomain(e: ComplianceApplicationOrmEntity): ComplianceApplication {
  return {
    id: e.id,
    organizationId: e.organizationId,
    name: e.name,
    description: e.description,
    status: e.status,
    rateLimitPerMin: e.rateLimitPerMin,
    createdByUserId: e.createdByUserId,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

@Injectable()
export class ComplianceApplicationTypeOrmRepository
  implements IComplianceApplicationRepository
{
  constructor(
    @InjectRepository(ComplianceApplicationOrmEntity)
    private readonly repo: Repository<ComplianceApplicationOrmEntity>,
  ) {}

  async findById(id: string): Promise<ComplianceApplication | null> {
    const e = await this.repo.findOne({ where: { id } });
    return e ? toDomain(e) : null;
  }

  async findByOrganizationId(
    organizationId: string,
  ): Promise<ComplianceApplication[]> {
    const rows = await this.repo.find({
      where: { organizationId },
      order: { createdAt: 'ASC' },
    });
    return rows.map(toDomain);
  }

  async save(application: ComplianceApplication): Promise<ComplianceApplication> {
    const e = this.repo.create(application);
    await this.repo.save(e);
    return toDomain(e);
  }

  async delete(id: string): Promise<void> {
    await this.repo.delete({ id });
  }
}
