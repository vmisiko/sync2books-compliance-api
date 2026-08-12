import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MAIN_API_CONNECTION_REPO } from '../../shared/tokens';
import { DashboardIdentityModule } from '../../dashboard-identity/dashboard-identity.module';
import { MainApiConnectionApplicationService } from './application/main-api-connection.application.service';
import { MainApiPullClient } from './infrastructure/http/main-api-pull.client';
import { MainApiConnectionOrmEntity } from './infrastructure/persistence/main-api-connection.orm-entity';
import { MainApiConnectionTypeOrmRepository } from './infrastructure/persistence/main-api-connection.typeorm.repository';
import { MainApiConnectionController } from './presentation/main-api-connection.controller';

@Module({
  imports: [
    DashboardIdentityModule,
    TypeOrmModule.forFeature([MainApiConnectionOrmEntity]),
  ],
  controllers: [MainApiConnectionController],
  providers: [
    MainApiConnectionTypeOrmRepository,
    {
      provide: MAIN_API_CONNECTION_REPO,
      useExisting: MainApiConnectionTypeOrmRepository,
    },
    MainApiConnectionApplicationService,
    MainApiPullClient,
  ],
  exports: [MAIN_API_CONNECTION_REPO, MainApiConnectionApplicationService, MainApiPullClient],
})
export class MainApiPullModule {}
