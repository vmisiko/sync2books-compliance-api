import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { IComplianceApiKeyRepository } from '../../application/ports/compliance-api-key.repository.port';
import type { ComplianceApiKey } from '../../domain/entities/compliance-api-key.entity';
import { ComplianceApiKeyOrmEntity } from './compliance-api-key.orm-entity';

function toDomain(e: ComplianceApiKeyOrmEntity): ComplianceApiKey {
  return {
    id: e.id,
    applicationId: e.applicationId,
    environment: e.environment,
    keyPrefix: e.keyPrefix,
    keyHash: e.keyHash,
    lastFour: e.lastFour,
    name: e.name,
    scopes: e.scopes ?? [],
    status: e.status,
    lastUsedAt: e.lastUsedAt,
    expiresAt: e.expiresAt,
    createdByUserId: e.createdByUserId,
    revokedAt: e.revokedAt,
    revokedByUserId: e.revokedByUserId,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

@Injectable()
export class ComplianceApiKeyTypeOrmRepository
  implements IComplianceApiKeyRepository
{
  constructor(
    @InjectRepository(ComplianceApiKeyOrmEntity)
    private readonly repo: Repository<ComplianceApiKeyOrmEntity>,
  ) {}

  async findByHash(keyHash: string): Promise<ComplianceApiKey | null> {
    const e = await this.repo.findOne({ where: { keyHash } });
    return e ? toDomain(e) : null;
  }

  async findById(id: string): Promise<ComplianceApiKey | null> {
    const e = await this.repo.findOne({ where: { id } });
    return e ? toDomain(e) : null;
  }

  async findByApplicationId(
    applicationId: string,
  ): Promise<ComplianceApiKey[]> {
    const rows = await this.repo.find({
      where: { applicationId },
      order: { createdAt: 'DESC' },
    });
    return rows.map(toDomain);
  }

  async save(key: ComplianceApiKey): Promise<ComplianceApiKey> {
    const e = this.repo.create(key);
    await this.repo.save(e);
    return toDomain(e);
  }

  async touchLastUsedAt(id: string, at: Date): Promise<void> {
    await this.repo.update({ id }, { lastUsedAt: at });
  }
}
