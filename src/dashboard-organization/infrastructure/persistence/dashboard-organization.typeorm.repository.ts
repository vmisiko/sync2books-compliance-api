import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { IDashboardOrganizationRepository } from '../../application/ports/dashboard-organization.repository.port';
import type { DashboardOrganization } from '../../domain/entities/dashboard-organization.entity';
import { DashboardOrganizationOrmEntity } from './dashboard-organization.orm-entity';

function toDomain(e: DashboardOrganizationOrmEntity): DashboardOrganization {
  return {
    id: e.id,
    displayName: e.displayName,
    mainApiOrganizationId: e.mainApiOrganizationId,
    mainApiApplicationId: e.mainApiApplicationId,
    mainApiApiKey: e.mainApiApiKey,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

@Injectable()
export class DashboardOrganizationTypeOrmRepository
  implements IDashboardOrganizationRepository
{
  constructor(
    @InjectRepository(DashboardOrganizationOrmEntity)
    private readonly repo: Repository<DashboardOrganizationOrmEntity>,
  ) {}

  async findById(id: string): Promise<DashboardOrganization | null> {
    const e = await this.repo.findOne({ where: { id } });
    return e ? toDomain(e) : null;
  }

  async save(organization: DashboardOrganization): Promise<DashboardOrganization> {
    const e = this.repo.create({
      id: organization.id,
      displayName: organization.displayName,
      mainApiOrganizationId: organization.mainApiOrganizationId,
      mainApiApplicationId: organization.mainApiApplicationId,
      mainApiApiKey: organization.mainApiApiKey,
      createdAt: organization.createdAt,
      updatedAt: organization.updatedAt,
    });
    await this.repo.save(e);
    return toDomain(e);
  }
}
