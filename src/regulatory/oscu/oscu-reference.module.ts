import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OscuCodeClassOrmEntity } from './infrastructure/persistence/oscu-code-class.orm-entity';
import { OscuCodeOrmEntity } from './infrastructure/persistence/oscu-code.orm-entity';

/**
 * The oscu_code_classes/oscu_codes tables are populated exclusively from KRA's
 * own /selectCodeList endpoint (see sync-code-list.usecase.ts, wired up via
 * CatalogService.syncCodeList / the daily reference-data sync) -- never from
 * a hand-authored local seed. A hardcoded seed here previously shipped a
 * "minimal common set" that silently diverged from KRA's actual code list
 * (e.g. it never had a 2-char code for Litre, because none exists -- KRA's
 * real list only has "L" and "LTR") and left stale/incorrect rows in place
 * whenever the real sync hadn't yet run for a code a merchant needed.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([OscuCodeClassOrmEntity, OscuCodeOrmEntity]),
  ],
  exports: [TypeOrmModule],
})
export class OscuReferenceModule {}
