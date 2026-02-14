import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CatalogItemOrmEntity } from './catalog-item.orm-entity';

@Injectable()
export class CatalogSeed {
  constructor(
    @InjectRepository(CatalogItemOrmEntity)
    private readonly repo: Repository<CatalogItemOrmEntity>,
  ) {}

  async runIfEmpty(): Promise<void> {
    const count = await this.repo.count();
    if (count > 0) return;

    const item = this.repo.create({
      id: 'item-1',
      merchantId: 'merchant-1',
      externalId: 'ext-item-1',
      name: 'Test Item',
      sku: 'SKU-001',
      itemType: 'GOODS',
      taxCategory: 'VAT_STANDARD',
      classificationCode: '1234567890',
      unitCode: 'EA',
      registrationStatus: 'REGISTERED',
      version: 1,
      lastSyncedAt: new Date(),
    });
    await this.repo.save(item);
  }
}
