import { Test, TestingModule } from '@nestjs/testing';
import type { Request } from 'express';
import { DashboardMappingsController } from './dashboard-mappings.controller';
import { DashboardMappingApplicationService } from '../application/dashboard-mapping.application.service';
import type { DashboardRequestUser } from '../../dashboard-identity/infrastructure/strategies/dashboard-jwt.strategy';

function reqFor(user: DashboardRequestUser): Request {
  return { user } as unknown as Request;
}

describe('DashboardMappingsController', () => {
  let controller: DashboardMappingsController;
  let service: {
    pullAll: jest.Mock;
    list: jest.Mock;
    summary: jest.Mock;
    approve: jest.Mock;
    update: jest.Mock;
    createManual: jest.Mock;
    listTaxCategoryOptions: jest.Mock;
  };

  const user: DashboardRequestUser = {
    userId: 'user-1',
    email: 'reviewer@example.com',
    role: 'admin',
    tenantId: 'tenant-1',
  };

  beforeEach(async () => {
    service = {
      pullAll: jest.fn(),
      list: jest.fn(),
      summary: jest.fn(),
      approve: jest.fn(),
      update: jest.fn(),
      createManual: jest.fn(),
      listTaxCategoryOptions: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DashboardMappingsController],
      providers: [
        { provide: DashboardMappingApplicationService, useValue: service },
      ],
    }).compile();

    controller = module.get(DashboardMappingsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('pull() delegates to pullAll with the tenant from the JWT', async () => {
    service.pullAll.mockResolvedValue({ attempted: 1 });
    const result = await controller.pull(reqFor(user));
    expect(service.pullAll).toHaveBeenCalledWith('tenant-1');
    expect(result).toEqual({
      success: true,
      message: 'Tax rates, tax codes, units, and classifications pulled and scored',
      data: { attempted: 1 },
    });
  });

  it('list() forwards query filters and tenant to the service', async () => {
    service.list.mockResolvedValue([{ id: 'taxmap-1' }]);
    const result = await controller.list(
      reqFor(user),
      'quickbooks',
      'tax',
      'mapped',
    );
    expect(service.list).toHaveBeenCalledWith('tenant-1', {
      source: 'quickbooks',
      type: 'tax',
      status: 'mapped',
    });
    expect(result.data).toEqual([{ id: 'taxmap-1' }]);
  });

  it('summary() forwards the tenant and returns the service result', async () => {
    service.summary.mockResolvedValue({
      global: { mapped: 1, total: 1 },
      bySource: [],
      overall: { mapped: 1, total: 1 },
    });
    const result = await controller.summary(reqFor(user));
    expect(service.summary).toHaveBeenCalledWith('tenant-1');
    expect(result.data.overall).toEqual({ mapped: 1, total: 1 });
  });

  it('approve() passes the authenticated user email as approvedBy, never a client-supplied value', async () => {
    service.approve.mockResolvedValue({ id: 'taxmap-1', status: 'MAPPED' });
    // Note: approve() takes no request body at all — there is no field a
    // caller could use to spoof approvedBy even if they tried.
    const result = await controller.approve(reqFor(user), 'taxmap-1');
    expect(service.approve).toHaveBeenCalledWith(
      'tenant-1',
      'taxmap-1',
      'reviewer@example.com',
    );
    expect(result.data).toEqual({ id: 'taxmap-1', status: 'MAPPED' });
  });

  it('update() passes the authenticated user email as approvedBy, ignoring anything on the body', async () => {
    service.update.mockResolvedValue({ id: 'taxmap-1', status: 'REVISED' });
    const body = { taxTyCd: 'D' } as never;
    await controller.update(reqFor(user), 'taxmap-1', body);
    expect(service.update).toHaveBeenCalledWith(
      'tenant-1',
      'taxmap-1',
      body,
      'reviewer@example.com',
    );
  });

  it('taxCategories() returns the KRA tax-type code options from the service, unauthenticated by tenant (a shared reference list)', async () => {
    service.listTaxCategoryOptions.mockResolvedValue([
      {
        internalTaxCategory: 'VAT_STANDARD',
        taxTyCd: 'B',
        cdNm: 'VAT Standard',
        label: 'B — VAT Standard',
      },
    ]);
    const result = await controller.taxCategories();
    expect(service.listTaxCategoryOptions).toHaveBeenCalledWith();
    expect(result).toEqual({
      success: true,
      message: 'OK',
      data: [
        {
          internalTaxCategory: 'VAT_STANDARD',
          taxTyCd: 'B',
          cdNm: 'VAT Standard',
          label: 'B — VAT Standard',
        },
      ],
    });
  });

  it('create() passes the authenticated user email as the creator', async () => {
    service.createManual.mockResolvedValue({ id: 'taxmap-1' });
    const body = {
      type: 'tax',
      internalTaxCategory: 'VAT_STANDARD',
      taxTyCd: 'B',
    } as never;
    await controller.create(reqFor(user), body);
    expect(service.createManual).toHaveBeenCalledWith(
      'tenant-1',
      body,
      'reviewer@example.com',
    );
  });
});
