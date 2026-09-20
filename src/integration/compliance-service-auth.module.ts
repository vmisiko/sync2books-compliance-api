import { Module } from '@nestjs/common';
import { ComplianceServiceAuthGuard } from './compliance-service-auth.guard';
import { AssertedMerchantGuard } from './asserted-merchant.guard';

@Module({
  providers: [ComplianceServiceAuthGuard, AssertedMerchantGuard],
  exports: [ComplianceServiceAuthGuard, AssertedMerchantGuard],
})
export class ComplianceServiceAuthModule {}
