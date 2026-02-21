import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaxCategory } from '../../../../shared/domain/enums/tax-category.enum';
import { PaymentTypeMappingOrmEntity } from './payment-type-mapping.orm-entity';
import { TaxMappingOrmEntity } from './tax-mapping.orm-entity';
import { UnitMappingOrmEntity } from './unit-mapping.orm-entity';

@Injectable()
export class OscuMappingSeed {
  constructor(
    @InjectRepository(TaxMappingOrmEntity)
    private readonly taxRepo: Repository<TaxMappingOrmEntity>,
    @InjectRepository(UnitMappingOrmEntity)
    private readonly unitRepo: Repository<UnitMappingOrmEntity>,
    @InjectRepository(PaymentTypeMappingOrmEntity)
    private readonly paymentRepo: Repository<PaymentTypeMappingOrmEntity>,
  ) {}

  async runIfEmpty(): Promise<void> {
    const taxCount = await this.taxRepo.count();
    const unitCount = await this.unitRepo.count();
    const paymentCount = await this.paymentRepo.count();
    if (taxCount > 0 && unitCount > 0 && paymentCount > 0) return;

    if (taxCount === 0) {
      await this.taxRepo.save(
        [
          // Global defaults (merchantId = null)
          { internalTaxCategory: TaxCategory.EXEMPT, taxTyCd: 'A' },
          { internalTaxCategory: TaxCategory.VAT_STANDARD, taxTyCd: 'B' },
          { internalTaxCategory: TaxCategory.VAT_ZERO, taxTyCd: 'C' },
          { internalTaxCategory: TaxCategory.OTHER, taxTyCd: 'D' },
        ].map((m) =>
          this.taxRepo.create({
            id: `taxmap-global-${m.internalTaxCategory}`,
            merchantId: null,
            internalTaxCategory: m.internalTaxCategory,
            taxTyCd: m.taxTyCd,
            version: 1,
            active: true,
          }),
        ),
      );
    }

    if (unitCount === 0) {
      await this.unitRepo.save(
        [
          // Global defaults (merchantId = null)
          // Internal 'EA' -> qty 'U' + packaging 'NT'
          { internalUnit: 'EA', qtyUnitCd: 'U', pkgUnitCd: 'NT' },
          // Some common internal variants
          { internalUnit: 'EACH', qtyUnitCd: 'U', pkgUnitCd: 'NT' },
          { internalUnit: 'PCS', qtyUnitCd: 'U', pkgUnitCd: 'NT' },
          { internalUnit: 'KG', qtyUnitCd: 'KG', pkgUnitCd: 'NT' },
          { internalUnit: 'KILOGRAM', qtyUnitCd: 'KG', pkgUnitCd: 'NT' },
          { internalUnit: 'L', qtyUnitCd: 'LTR', pkgUnitCd: 'NT' },
          { internalUnit: 'LTR', qtyUnitCd: 'LTR', pkgUnitCd: 'NT' },
          { internalUnit: 'LITRE', qtyUnitCd: 'LTR', pkgUnitCd: 'NT' },
        ].map((m) =>
          this.unitRepo.create({
            id: `unitmap-global-${m.internalUnit}`,
            merchantId: null,
            internalUnit: m.internalUnit,
            qtyUnitCd: m.qtyUnitCd,
            pkgUnitCd: m.pkgUnitCd,
            version: 1,
            active: true,
          }),
        ),
      );
    }

    if (paymentCount === 0) {
      await this.paymentRepo.save(
        [
          // Global defaults (merchantId = null). OSCU cdCls=07.
          { internalPaymentMethod: 'CASH', pmtTyCd: '01' },
          { internalPaymentMethod: 'CREDIT', pmtTyCd: '02' },
          { internalPaymentMethod: 'CASH_CREDIT', pmtTyCd: '03' },
          { internalPaymentMethod: 'BANK_CHECK', pmtTyCd: '04' },
          { internalPaymentMethod: 'DEBIT_CREDIT', pmtTyCd: '05' },
          { internalPaymentMethod: 'CARD', pmtTyCd: '06' },
          { internalPaymentMethod: 'MOBILE_MONEY', pmtTyCd: '07' },
          { internalPaymentMethod: 'OTHER', pmtTyCd: '08' },
        ].map((m) =>
          this.paymentRepo.create({
            id: `paymap-global-${m.internalPaymentMethod}`,
            merchantId: null,
            internalPaymentMethod: m.internalPaymentMethod,
            pmtTyCd: m.pmtTyCd,
            version: 1,
            active: true,
          }),
        ),
      );
    }
  }
}
