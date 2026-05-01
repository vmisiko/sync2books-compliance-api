import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CONNECTION_REPO } from '../shared/tokens';
import { ComplianceOrganizationApplicationService } from './application/compliance-organization.application.service';
import { ComplianceBranchOrmEntity } from './infrastructure/persistence/compliance-branch.orm-entity';
import { ComplianceBranchTypeOrmRepository } from './infrastructure/persistence/compliance-branch.typeorm.repository';
import { ComplianceEtimsConnectionOrmEntity } from './infrastructure/persistence/compliance-etims-connection.orm-entity';
import { ComplianceOrganizationConnectionTypeOrmRepository } from './infrastructure/persistence/compliance-organization-connection.typeorm.repository';
import { ComplianceOrganizationSeed } from './infrastructure/persistence/compliance-organization.seed';
import { ComplianceTenantOrmEntity } from './infrastructure/persistence/compliance-tenant.orm-entity';
import { ComplianceTenantTypeOrmRepository } from './infrastructure/persistence/compliance-tenant.typeorm.repository';
import { ComplianceOrganizationController } from './presentation/compliance-organization.controller';
import { EtimsModule } from '../regulatory/oscu/etims.module';
import { ComplianceServiceAuthModule } from '../integration/compliance-service-auth.module';

@Module({
  imports: [
    ComplianceServiceAuthModule,
    EtimsModule,
    TypeOrmModule.forFeature([
      ComplianceTenantOrmEntity,
      ComplianceBranchOrmEntity,
      ComplianceEtimsConnectionOrmEntity,
    ]),
  ],
  controllers: [ComplianceOrganizationController],
  providers: [
    ComplianceTenantTypeOrmRepository,
    ComplianceBranchTypeOrmRepository,
    ComplianceOrganizationConnectionTypeOrmRepository,
    ComplianceOrganizationApplicationService,
    ComplianceOrganizationSeed,
    {
      provide: CONNECTION_REPO,
      useExisting: ComplianceOrganizationConnectionTypeOrmRepository,
    },
  ],
  exports: [CONNECTION_REPO, ComplianceOrganizationApplicationService],
})
export class ComplianceOrganizationModule implements OnModuleInit {
  constructor(private readonly seed: ComplianceOrganizationSeed) {}

  async onModuleInit(): Promise<void> {
    await this.seed.runIfEmpty();
  }
}
