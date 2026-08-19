import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaxCategory } from '../../../../shared/domain/enums/tax-category.enum';
import { MappingStatus } from '../../../../shared/domain/enums/mapping-status.enum';
import { PaymentTypeMappingOrmEntity } from './payment-type-mapping.orm-entity';
import { TaxMappingOrmEntity } from './tax-mapping.orm-entity';

@Injectable()
export class OscuMappingSeed {
  constructor(
    @InjectRepository(TaxMappingOrmEntity)
    private readonly taxRepo: Repository<TaxMappingOrmEntity>,
    @InjectRepository(PaymentTypeMappingOrmEntity)
    private readonly paymentRepo: Repository<PaymentTypeMappingOrmEntity>,
  ) {}

  async runIfEmpty(): Promise<void> {
    const taxCount = await this.taxRepo.count();
    const paymentCount = await this.paymentRepo.count();
    if (taxCount > 0 && paymentCount > 0) return;

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
            status: MappingStatus.MAPPED,
          }),
        ),
      );
    }
  }
}
