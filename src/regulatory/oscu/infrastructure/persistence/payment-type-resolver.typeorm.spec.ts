import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaymentTypeMappingOrmEntity } from './payment-type-mapping.orm-entity';
import { PaymentTypeResolverTypeOrm } from './payment-type-resolver.typeorm';
import { MappingStatus } from '../../../../shared/domain/enums/mapping-status.enum';

describe('PaymentTypeResolverTypeOrm', () => {
  let module: TestingModule;
  let resolver: PaymentTypeResolverTypeOrm;
  let paymentRepo: Repository<PaymentTypeMappingOrmEntity>;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'sqljs',
          autoSave: false,
          autoLoadEntities: true,
          synchronize: true,
          logging: false,
        }),
        TypeOrmModule.forFeature([PaymentTypeMappingOrmEntity]),
      ],
      providers: [PaymentTypeResolverTypeOrm],
    }).compile();
    await module.init();

    resolver = module.get(PaymentTypeResolverTypeOrm);
    paymentRepo = module.get(getRepositoryToken(PaymentTypeMappingOrmEntity));

    await paymentRepo.save(
      paymentRepo.create({
        id: 'paymap-global-CREDIT',
        merchantId: null,
        internalPaymentMethod: 'CREDIT',
        pmtTyCd: '02',
        version: 1,
        active: true,
        status: MappingStatus.MAPPED,
      }),
    );
  });

  afterEach(async () => {
    await module.close();
  });

  it('resolves from the global default when no merchant override exists', async () => {
    await expect(resolver.resolve('merchant-1', 'CREDIT')).resolves.toBe('02');
  });

  it('prefers an active merchant-specific row over the global default', async () => {
    await paymentRepo.save(
      paymentRepo.create({
        id: 'paymap-merchant-1-CREDIT',
        merchantId: 'merchant-1',
        internalPaymentMethod: 'CREDIT',
        pmtTyCd: '03',
        version: 1,
        active: true,
        status: MappingStatus.MAPPED,
      }),
    );

    await expect(resolver.resolve('merchant-1', 'CREDIT')).resolves.toBe('03');
    // Unaffected tenant still gets the global default.
    await expect(resolver.resolve('merchant-2', 'CREDIT')).resolves.toBe('02');
  });

  it('throws when neither a merchant nor a global active mapping exists', async () => {
    await expect(
      resolver.resolve('merchant-1', 'NOT_A_REAL_METHOD'),
    ).rejects.toThrow(/Missing payment mapping/);
  });
});
