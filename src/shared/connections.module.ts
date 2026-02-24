import { Module } from '@nestjs/common';
import { CONNECTION_REPO } from './tokens';
import {
  ConnectionRepositoryStub,
  seedStubData,
} from '../sales/infrastructure/persistence/repository.stub';

@Module({
  providers: [{ provide: CONNECTION_REPO, useClass: ConnectionRepositoryStub }],
  exports: [CONNECTION_REPO],
})
export class ConnectionsModule {
  constructor() {
    seedStubData();
  }
}
