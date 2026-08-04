import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OscuOperationsController } from './oscu-operations.controller';
import { OscuOperationsService } from './oscu-operations.service';
import { OscuOperationLogOrmEntity } from '../infrastructure/persistence/oscu-operation-log.orm-entity';
import { ComplianceOrganizationModule } from '../../../compliance-organization/compliance-organization.module';
import { EtimsModule } from '../etims.module';
import { ComplianceServiceAuthModule } from '../../../integration/compliance-service-auth.module';

@Module({
  imports: [
    ComplianceServiceAuthModule,
    ComplianceOrganizationModule,
    EtimsModule,
    TypeOrmModule.forFeature([OscuOperationLogOrmEntity]),
  ],
  controllers: [OscuOperationsController],
  providers: [OscuOperationsService],
})
export class OscuOperationsModule {}
