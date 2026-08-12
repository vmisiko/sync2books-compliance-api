import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { IDashboardUserRepository } from '../../application/ports/dashboard-user.repository.port';
import type { DashboardUser } from '../../domain/entities/dashboard-user.entity';
import { DashboardUserOrmEntity } from './dashboard-user.orm-entity';

function toDomain(e: DashboardUserOrmEntity): DashboardUser {
  return {
    id: e.id,
    email: e.email,
    passwordHash: e.passwordHash,
    displayName: e.displayName,
    role: e.role,
    complianceTenantId: e.complianceTenantId,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

@Injectable()
export class DashboardUserTypeOrmRepository implements IDashboardUserRepository {
  constructor(
    @InjectRepository(DashboardUserOrmEntity)
    private readonly repo: Repository<DashboardUserOrmEntity>,
  ) {}

  async findById(id: string): Promise<DashboardUser | null> {
    const e = await this.repo.findOne({ where: { id } });
    return e ? toDomain(e) : null;
  }

  async findByEmail(email: string): Promise<DashboardUser | null> {
    const e = await this.repo.findOne({ where: { email: email.toLowerCase() } });
    return e ? toDomain(e) : null;
  }

  async save(user: DashboardUser): Promise<DashboardUser> {
    const e = this.repo.create({
      id: user.id,
      email: user.email.toLowerCase(),
      passwordHash: user.passwordHash,
      displayName: user.displayName,
      role: user.role,
      complianceTenantId: user.complianceTenantId,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    });
    await this.repo.save(e);
    return toDomain(e);
  }
}
