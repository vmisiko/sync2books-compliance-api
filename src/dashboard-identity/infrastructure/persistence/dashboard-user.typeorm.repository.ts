import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { IDashboardUserRepository } from '../../application/ports/dashboard-user.repository.port';
import type {
  DashboardOAuthProvider,
  DashboardUser,
  DashboardUserStatus,
} from '../../domain/entities/dashboard-user.entity';
import { DashboardUserOrmEntity } from './dashboard-user.orm-entity';

function toDomain(e: DashboardUserOrmEntity): DashboardUser {
  return {
    id: e.id,
    email: e.email,
    passwordHash: e.passwordHash,
    displayName: e.displayName,
    role: e.role,
    organizationId: e.organizationId,
    // Rows created before this column existed read back as NULL -- default
    // them to 'active' rather than trusting the column is always populated
    // (see the organizationId backfill this session for why that matters).
    status: (e.status as DashboardUserStatus | null) ?? 'active',
    oauthProvider: e.oauthProvider as DashboardOAuthProvider | null,
    oauthSubject: e.oauthSubject,
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
    const e = await this.repo.findOne({
      where: { email: email.toLowerCase() },
    });
    return e ? toDomain(e) : null;
  }

  async listByOrganizationId(organizationId: string): Promise<DashboardUser[]> {
    const rows = await this.repo.find({ where: { organizationId } });
    return rows.map(toDomain);
  }

  async save(user: DashboardUser): Promise<DashboardUser> {
    const e = this.repo.create({
      id: user.id,
      email: user.email.toLowerCase(),
      passwordHash: user.passwordHash,
      displayName: user.displayName,
      role: user.role,
      organizationId: user.organizationId,
      status: user.status,
      oauthProvider: user.oauthProvider,
      oauthSubject: user.oauthSubject,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    });
    await this.repo.save(e);
    return toDomain(e);
  }
}
