import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { IMainApiConnectionRepository } from '../../application/ports/main-api-connection.repository.port';
import type { MainApiConnection } from '../../domain/entities/main-api-connection.entity';
import { MainApiConnectionOrmEntity } from './main-api-connection.orm-entity';

function toDomain(e: MainApiConnectionOrmEntity): MainApiConnection {
  return {
    id: e.id,
    complianceTenantId: e.complianceTenantId,
    mainApiApplicationId: e.mainApiApplicationId,
    mainApiApiKey: e.mainApiApiKey,
    quickbooksConnectionId: e.quickbooksConnectionId,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

@Injectable()
export class MainApiConnectionTypeOrmRepository
  implements IMainApiConnectionRepository
{
  constructor(
    @InjectRepository(MainApiConnectionOrmEntity)
    private readonly repo: Repository<MainApiConnectionOrmEntity>,
  ) {}

  async findByTenantId(
    complianceTenantId: string,
  ): Promise<MainApiConnection | null> {
    const e = await this.repo.findOne({ where: { complianceTenantId } });
    return e ? toDomain(e) : null;
  }

  async save(connection: MainApiConnection): Promise<MainApiConnection> {
    const e = this.repo.create({
      id: connection.id,
      complianceTenantId: connection.complianceTenantId,
      mainApiApplicationId: connection.mainApiApplicationId,
      mainApiApiKey: connection.mainApiApiKey,
      quickbooksConnectionId: connection.quickbooksConnectionId,
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt,
    });
    await this.repo.save(e);
    return toDomain(e);
  }
}
