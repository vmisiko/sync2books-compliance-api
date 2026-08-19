import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import type { IPaymentTypeResolver } from '../../domain/ports/payment-type-resolver.port';
import { PaymentTypeMappingOrmEntity } from './payment-type-mapping.orm-entity';

/** Mirrors ClassificationResolverTypeOrm.resolveTaxTyCd — tenant row first, then global fallback. */
@Injectable()
export class PaymentTypeResolverTypeOrm implements IPaymentTypeResolver {
  constructor(
    @InjectRepository(PaymentTypeMappingOrmEntity)
    private readonly paymentRepo: Repository<PaymentTypeMappingOrmEntity>,
  ) {}

  async resolve(
    merchantId: string,
    internalPaymentMethod: string,
  ): Promise<string> {
    const merchant = await this.paymentRepo.findOne({
      where: { merchantId, internalPaymentMethod, active: true },
    });
    if (merchant) {
      // active:true rows are only ever set by DashboardMappingApplicationService's
      // approve()/update()/createManual(), all of which require pmtTyCd first — so
      // this is a data-integrity guard, not an expected path.
      if (!merchant.pmtTyCd) {
        throw new Error(
          `Active payment mapping for internalPaymentMethod=${internalPaymentMethod} has no pmtTyCd (merchantId=${merchantId})`,
        );
      }
      return merchant.pmtTyCd;
    }

    const global = await this.paymentRepo.findOne({
      where: { merchantId: IsNull(), internalPaymentMethod, active: true },
    });
    if (global) {
      if (!global.pmtTyCd) {
        throw new Error(
          `Active global payment mapping for internalPaymentMethod=${internalPaymentMethod} has no pmtTyCd`,
        );
      }
      return global.pmtTyCd;
    }

    throw new Error(
      `Missing payment mapping for internalPaymentMethod=${internalPaymentMethod} (merchantId=${merchantId})`,
    );
  }
}
