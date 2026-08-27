import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OscuItemClassificationOrmEntity } from './infrastructure/persistence/oscu-item-classification.orm-entity';
import { OscuSyncStateOrmEntity } from './infrastructure/persistence/oscu-sync-state.orm-entity';
import { OscuMappingSeed } from './infrastructure/persistence/oscu-mapping.seed';
import { PaymentTypeMappingOrmEntity } from './infrastructure/persistence/payment-type-mapping.orm-entity';
import { PaymentTypeResolverTypeOrm } from './infrastructure/persistence/payment-type-resolver.typeorm';
import { TaxMappingOrmEntity } from './infrastructure/persistence/tax-mapping.orm-entity';
import { UnitMappingOrmEntity } from './infrastructure/persistence/unit-mapping.orm-entity';
import { MappingSuggestionService } from './application/mapping-suggestion.service';
import { PAYMENT_TYPE_RESOLVER } from '../../shared/tokens';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OscuItemClassificationOrmEntity,
      OscuSyncStateOrmEntity,
      TaxMappingOrmEntity,
      PaymentTypeMappingOrmEntity,
      UnitMappingOrmEntity,
    ]),
  ],
  providers: [
    OscuMappingSeed,
    MappingSuggestionService,
    { provide: PAYMENT_TYPE_RESOLVER, useClass: PaymentTypeResolverTypeOrm },
  ],
  exports: [TypeOrmModule, MappingSuggestionService, PAYMENT_TYPE_RESOLVER],
})
export class OscuMappingModule implements OnModuleInit {
  constructor(private readonly seed: OscuMappingSeed) {}

  async onModuleInit(): Promise<void> {
    await this.seed.runIfEmpty();
  }
}
