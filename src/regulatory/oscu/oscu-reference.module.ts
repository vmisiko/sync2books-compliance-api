import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OscuCodeClassOrmEntity } from './infrastructure/persistence/oscu-code-class.orm-entity';
import { OscuCodeOrmEntity } from './infrastructure/persistence/oscu-code.orm-entity';
import { OscuReferenceSeed } from './infrastructure/persistence/oscu-reference.seed';

@Module({
  imports: [
    TypeOrmModule.forFeature([OscuCodeClassOrmEntity, OscuCodeOrmEntity]),
  ],
  providers: [OscuReferenceSeed],
  exports: [TypeOrmModule],
})
export class OscuReferenceModule implements OnModuleInit {
  constructor(private readonly seed: OscuReferenceSeed) {}

  async onModuleInit(): Promise<void> {
    await this.seed.runIfEmpty();
  }
}
