import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClassificationMappingOrmEntity } from './infrastructure/persistence/classification-mapping.orm-entity';
import { OscuItemClassificationOrmEntity } from './infrastructure/persistence/oscu-item-classification.orm-entity';
import { OscuSyncStateOrmEntity } from './infrastructure/persistence/oscu-sync-state.orm-entity';
import { OscuMappingSeed } from './infrastructure/persistence/oscu-mapping.seed';
import { TaxMappingOrmEntity } from './infrastructure/persistence/tax-mapping.orm-entity';
import { UnitMappingOrmEntity } from './infrastructure/persistence/unit-mapping.orm-entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OscuItemClassificationOrmEntity,
      OscuSyncStateOrmEntity,
      TaxMappingOrmEntity,
      UnitMappingOrmEntity,
      ClassificationMappingOrmEntity,
    ]),
  ],
  providers: [OscuMappingSeed],
  exports: [TypeOrmModule],
})
export class OscuMappingModule implements OnModuleInit {
  constructor(private readonly seed: OscuMappingSeed) {}

  async onModuleInit(): Promise<void> {
    await this.seed.runIfEmpty();
  }
}
