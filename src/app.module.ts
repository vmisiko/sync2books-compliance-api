import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CatalogModule } from './catalog/catalog.module';
import { InventoryModule } from './inventory/inventory.module';
import { OscuMappingModule } from './regulatory/oscu/oscu-mapping.module';
import { OscuReferenceModule } from './regulatory/oscu/oscu-reference.module';
import { SalesModule } from './sales/sales.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'sqljs',
      location:
        process.env.DATABASE_PATH ??
        process.env.DATABASE_URL ??
        'data/compliance',
      autoSave: true,
      autoLoadEntities: true,
      synchronize: process.env.NODE_ENV !== 'production',
      logging: process.env.NODE_ENV === 'development',
    }),
    OscuReferenceModule,
    OscuMappingModule,
    CatalogModule,
    InventoryModule,
    SalesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
