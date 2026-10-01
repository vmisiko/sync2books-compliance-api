import { ComplianceStatus } from '../../shared/domain/enums/compliance-status.enum';
import type { SaleCallback } from '../domain/sale-callback';
import type { ISaleCallbackStore } from './ports/sale-callback.store.port';
import { SaleCallbackService } from './sale-callback.service';

class MemoryStore implements ISaleCallbackStore {
  rows = new Map<string, SaleCallback>();

  async findByDocumentId(documentId: string) {
    const row = this.rows.get(documentId);
    return row ? { ...row } : null;
  }

  async save(callback: SaleCallback) {
    this.rows.set(callback.documentId, { ...callback });
    return callback;
  }

  async claim(
    documentId: string,
    outcomeKey: string,
    now: Date,
    leaseUntil: Date,
  ) {
    const row = this.rows.get(documentId);
    if (
      !row ||
      row.outcomeKey !== outcomeKey ||
      row.status !== 'pending' ||
      !row.nextAttemptAt ||
      row.nextAttemptAt > now
    ) {
      return false;
    }
    row.nextAttemptAt = leaseUntil;
    return true;
  }

  async findDue(now: Date) {
    return [...this.rows.values()].filter(
      (r) =>
        r.status === 'pending' && r.nextAttemptAt && r.nextAttemptAt <= now,
    );
  }
}

const URL_OK = 'https://erp.example.com/hooks/etims';

function report(status: string) {
  return {
    id: 'doc-1',
    date: '01/10/2026',
    traderInvoiceNumber: 'INV-001',
    isCreditNote: false,
    status,
    paymentTypeCode: '01',
    customerName: null,
    customerTin: null,
    customerPhoneNumber: null,
    customerEmail: null,
    itemList: [],
    syncErrorMessage: status === 'failed' ? 'Invalid itemCd' : null,
  };
}

function document(complianceStatus: ComplianceStatus, submissionAttempts = 1) {
  return {
    id: 'doc-1',
    merchantId: 'merchant-A',
    complianceStatus,
    submissionAttempts,
  } as never;
}

function build() {
  const store = new MemoryStore();
  let listener: ((doc: never) => Promise<void>) | undefined;
  const sales = {
    onOutcome: jest.fn((l) => {
      listener = l;
    }),
    getNormalizedSaleReport: jest.fn(async () => report('completed')),
  };
  const service = new SaleCallbackService(store, sales as never);
  let clock = new Date('2026-10-01T08:00:00Z');
  service.now = () => clock;
  service.resolveHost = jest.fn(async () => ['93.184.216.34']);
  service.onModuleInit();
  return {
    store,
    sales,
    service,
    announce: (doc: never) => listener!(doc),
    advance: (ms: number) => {
      clock = new Date(clock.getTime() + ms);
    },
  };
}

function respond(status: number) {
  return {
    status,
    body: { cancel: async () => undefined },
  } as unknown as Response;
}

describe('SaleCallbackService', () => {
  let fetchMock: jest.SpyInstance;
  let immediates: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
    // Deliveries are kicked off with setImmediate; run them by hand so each
    // test controls exactly when the POST happens.
    immediates = jest
      .spyOn(global, 'setImmediate')
      .mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    fetchMock.mockRestore();
    immediates.mockRestore();
  });

  it('subscribes to sale outcomes on startup', () => {
    const { sales } = build();
    expect(sales.onOutcome).toHaveBeenCalledTimes(1);
  });

  it('ignores a sale created without a callbackUrl', async () => {
    const { store, announce } = build();
    await announce(document(ComplianceStatus.ACCEPTED));
    expect(store.rows.size).toBe(0);
  });

  it('POSTs the accepted sale and records the delivery', async () => {
    const { store, service, announce } = build();
    await service.register('doc-1', 'merchant-A', URL_OK);
    await announce(document(ComplianceStatus.ACCEPTED));

    expect(store.rows.get('doc-1')?.status).toBe('pending');
    expect(immediates).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValue(respond(200));
    await service.deliver('doc-1', 'ACCEPTED:1');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(URL_OK);
    expect(init.redirect).toBe('manual');
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Callback-Event']).toBe('sale.completed');
    expect(headers['X-Callback-Id']).toBe('doc-1:ACCEPTED:1');
    const body = JSON.parse(init.body as string);
    expect(body.event).toBe('sale.completed');
    expect(body.data.sale.id).toBe('doc-1');
    expect(body.data.sale.status).toBe('completed');

    const row = store.rows.get('doc-1')!;
    expect(row.status).toBe('delivered');
    expect(row.attempts).toBe(1);
    expect(row.lastResponseStatus).toBe(200);
    expect(row.deliveredAt).toEqual(new Date('2026-10-01T08:00:00Z'));
  });

  it('announces a rejection as sale.failed', async () => {
    const { store, service, sales, announce } = build();
    sales.getNormalizedSaleReport.mockResolvedValue(report('failed'));
    await service.register('doc-1', 'merchant-A', URL_OK);
    await announce(document(ComplianceStatus.REJECTED));
    expect(store.rows.get('doc-1')?.event).toBe('sale.failed');
  });

  it('queues the same outcome once, however often it is announced', async () => {
    const { store, service, announce } = build();
    await service.register('doc-1', 'merchant-A', URL_OK);
    await announce(document(ComplianceStatus.ACCEPTED));
    fetchMock.mockResolvedValue(respond(200));
    await service.deliver('doc-1', 'ACCEPTED:1');

    await announce(document(ComplianceStatus.ACCEPTED));
    expect(store.rows.get('doc-1')?.status).toBe('delivered');
    expect(immediates).toHaveBeenCalledTimes(1);
  });

  it('delivers the new result after a rejected sale is retried and accepted', async () => {
    const { store, service, announce } = build();
    await service.register('doc-1', 'merchant-A', URL_OK);
    await announce(document(ComplianceStatus.REJECTED, 1));
    fetchMock.mockResolvedValue(respond(200));
    await service.deliver('doc-1', 'REJECTED:1');

    await announce(document(ComplianceStatus.ACCEPTED, 2));
    const row = store.rows.get('doc-1')!;
    expect(row.status).toBe('pending');
    expect(row.event).toBe('sale.completed');
    expect(row.attempts).toBe(0);
  });

  it('never announces to another merchant’s registration', async () => {
    const { store, service, announce } = build();
    await service.register('doc-1', 'merchant-B', URL_OK);
    await announce(document(ComplianceStatus.ACCEPTED));
    expect(store.rows.get('doc-1')?.status).toBe('awaiting_outcome');
  });

  it('retries a non-2xx answer with backoff, then gives up', async () => {
    const { store, service, announce, advance } = build();
    await service.register('doc-1', 'merchant-A', URL_OK);
    await announce(document(ComplianceStatus.ACCEPTED));
    fetchMock.mockResolvedValue(respond(503));

    await service.deliver('doc-1', 'ACCEPTED:1');
    let row = store.rows.get('doc-1')!;
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(1);
    expect(row.lastResponseStatus).toBe(503);
    expect(row.lastError).toBe('Endpoint answered HTTP 503');
    expect(row.nextAttemptAt).toEqual(new Date('2026-10-01T08:01:00Z'));

    // Not due yet: the sweep leaves it alone.
    await service.sweep();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 6; i++) {
      advance(7 * 60 * 60_000);
      await service.sweep();
    }
    row = store.rows.get('doc-1')!;
    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(row.status).toBe('failed');
    expect(row.attempts).toBe(7);
    expect(row.nextAttemptAt).toBeNull();
  });

  it('counts a redirect as a failed attempt rather than following it', async () => {
    const { store, service, announce } = build();
    await service.register('doc-1', 'merchant-A', URL_OK);
    await announce(document(ComplianceStatus.ACCEPTED));
    fetchMock.mockResolvedValue(respond(302));
    await service.deliver('doc-1', 'ACCEPTED:1');
    expect(store.rows.get('doc-1')?.status).toBe('pending');
    expect(store.rows.get('doc-1')?.lastResponseStatus).toBe(302);
  });

  it('records a network error', async () => {
    const { store, service, announce } = build();
    await service.register('doc-1', 'merchant-A', URL_OK);
    await announce(document(ComplianceStatus.ACCEPTED));
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await service.deliver('doc-1', 'ACCEPTED:1');
    const row = store.rows.get('doc-1')!;
    expect(row.lastResponseStatus).toBeNull();
    expect(row.lastError).toBe('fetch failed');
  });

  it('refuses to POST to a public name that resolves to a private address', async () => {
    const { store, service, announce } = build();
    service.resolveHost = jest.fn(async () => ['10.0.0.12']);
    await service.register('doc-1', 'merchant-A', URL_OK);
    await announce(document(ComplianceStatus.ACCEPTED));
    await service.deliver('doc-1', 'ACCEPTED:1');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.rows.get('doc-1')?.lastError).toBe(
      'erp.example.com does not resolve to a public address',
    );
  });

  it('delivers a claimed outcome once, even when two workers race', async () => {
    const { service, announce } = build();
    await service.register('doc-1', 'merchant-A', URL_OK);
    await announce(document(ComplianceStatus.ACCEPTED));
    fetchMock.mockResolvedValue(respond(200));
    await Promise.all([
      service.deliver('doc-1', 'ACCEPTED:1'),
      service.deliver('doc-1', 'ACCEPTED:1'),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('resend delivers a failed result again from a clean slate', async () => {
    const { store, service, announce } = build();
    await service.register('doc-1', 'merchant-A', URL_OK);
    await announce(document(ComplianceStatus.ACCEPTED));
    store.rows.set('doc-1', {
      ...store.rows.get('doc-1')!,
      status: 'failed',
      attempts: 7,
      nextAttemptAt: null,
    });
    fetchMock.mockResolvedValue(respond(204));

    const row = await service.resend('doc-1');
    expect(row?.status).toBe('delivered');
    expect(row?.attempts).toBe(1);
    expect(row?.lastResponseStatus).toBe(204);
  });
});
