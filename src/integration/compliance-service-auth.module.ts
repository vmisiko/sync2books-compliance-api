import { Module } from '@nestjs/common';
import { ComplianceServiceAuthGuard } from './compliance-service-auth.guard';

@Module({
  providers: [ComplianceServiceAuthGuard],
  exports: [ComplianceServiceAuthGuard],
})
export class ComplianceServiceAuthModule {}
