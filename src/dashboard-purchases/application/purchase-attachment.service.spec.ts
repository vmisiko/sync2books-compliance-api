import {
  ConflictException,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import {
  MainApiHttpError,
  type MainApiPullClient,
} from '../../integration/main-api-pull/infrastructure/http/main-api-pull.client';
import type { MainApiConnectionApplicationService } from '../../integration/main-api-pull/application/main-api-connection.application.service';
import type { PurchaseInvoiceOrmEntity } from '../infrastructure/persistence/purchase-invoice.orm-entity';
import type { PurchaseInvoiceAttachmentOrmEntity } from '../infrastructure/persistence/purchase-invoice-attachment.orm-entity';
import type { PurchaseBillMappingService } from './purchase-bill-mapping.service';
import {
  PURCHASE_ATTACHMENT_MAX_BYTES,
  PurchaseAttachmentService,
  detectFileType,
  sanitiseFilename,
} from './purchase-attachment.service';

const PDF = Buffer.from('%PDF-1.4\nbody');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('x')]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);

const MERCHANT_A = 'merchant-a';
const MERCHANT_B = 'merchant-b';

function build(opts: { synced?: boolean } = {}) {
  const invoices: Record<string, Partial<PurchaseInvoiceOrmEntity>> = {
    'inv-a': { id: 'inv-a', merchantId: MERCHANT_A, erpSyncStatus: opts.synced ? 'synced' : 'not_synced', erpBillId: opts.synced ? 'bill-1' : null },
    'inv-a2': { id: 'inv-a2', merchantId: MERCHANT_A, erpSyncStatus: 'not_synced', erpBillId: null },
    'inv-b': { id: 'inv-b', merchantId: MERCHANT_B, erpSyncStatus: 'not_synced', erpBillId: null },
  };
  const store: PurchaseInvoiceAttachmentOrmEntity[] = [];
  let seq = 0;
  const purchases = {
    findOne: jest.fn(async ({ where }: any) => {
      const r = invoices[where.id];
      return r && r.merchantId === where.merchantId ? r : null;
    }),
  };
  const attachments = {
    create: (x: any) => ({ ...x }),
    save: jest.fn(async (x: any) => {
      const row = { ...x, id: `att-${++seq}`, createdAt: new Date() };
      store.push(row);
      return row;
    }),
    count: jest.fn(async ({ where }: any) =>
      store.filter((a) => a.merchantId === where.merchantId && a.purchaseInvoiceId === where.purchaseInvoiceId).length),
    find: jest.fn(async ({ where }: any) =>
      store.filter((a) => a.merchantId === where.merchantId && a.purchaseInvoiceId === where.purchaseInvoiceId)),
    update: jest.fn(async (crit: any, patch: any) => {
      Object.assign(store.find((a) => a.id === crit.id)!, patch);
    }),
    delete: jest.fn(async (crit: any) => {
      const i = store.findIndex((a) => a.id === crit.id && a.merchantId === crit.merchantId && a.purchaseInvoiceId === crit.purchaseInvoiceId);
      if (i >= 0) store.splice(i, 1);
    }),
    createQueryBuilder: jest.fn(() => {
      const params: Record<string, string> = {};
      const qb: any = {
        where: (_s: string, p: any) => (Object.assign(params, p), qb),
        andWhere: (_s: string, p: any) => (Object.assign(params, p), qb),
        addSelect: () => qb,
        getOne: async () =>
          store.find((a) => a.id === params.attachmentId && a.merchantId === params.merchantId && a.purchaseInvoiceId === params.purchaseInvoiceId) ?? null,
      };
      return qb;
    }),
  };
  const connections = {
    resolveMerchantId: jest.fn(async (t: string) => (t === 'tenant-a' ? MERCHANT_A : MERCHANT_B)),
  };
  const attachToBill = jest.fn();
  const client = { attachToBill };
  const mapping = {
    resolveForSync: jest.fn(async () => ({ connectionId: 'conn-1', mainApiApiKey: 'k', integrationKey: 'quickbooks' })),
  };
  const svc = new PurchaseAttachmentService(
    purchases as any,
    attachments as any,
    connections as unknown as MainApiConnectionApplicationService,
    client as unknown as MainApiPullClient,
    mapping as unknown as PurchaseBillMappingService,
  );
  return { svc, store, attachToBill };
}

const file = (buf: Buffer, name = 'a.pdf') => ({ originalname: name, buffer: buf, size: buf.length });

describe('PurchaseAttachmentService', () => {
  it('detects by magic bytes and sanitises names', () => {
    expect(detectFileType(PDF)?.ext).toBe('pdf');
    expect(detectFileType(PNG)?.ext).toBe('png');
    expect(detectFileType(JPG)?.ext).toBe('jpg');
    expect(detectFileType(Buffer.from('<html>'))).toBeNull();
    expect(sanitiseFilename('../../etc/pa"ss<wd>.exe', 'pdf')).toBe('pa_ss_wd_.pdf');
  });

  it('uploads, lists, downloads and deletes', async () => {
    const { svc, store } = build();
    const { attachment, pushError } = await svc.upload('tenant-a', 'inv-a', file(PDF));
    expect(pushError).toBeNull();
    expect(attachment).not.toHaveProperty('content');
    expect(attachment.mime).toBe('application/pdf');
    expect(await svc.list('tenant-a', 'inv-a')).toHaveLength(1);
    const dl = await svc.download('tenant-a', 'inv-a', attachment.id);
    expect(dl.content.equals(PDF)).toBe(true);
    await svc.remove('tenant-a', 'inv-a', attachment.id);
    expect(store).toHaveLength(0);
  });

  it('rejects a mismatched type (content, not extension) with 415', async () => {
    const { svc } = build();
    await expect(svc.upload('tenant-a', 'inv-a', file(Buffer.from('MZ not a pdf'), 'evil.pdf'))).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
  });

  it('rejects oversize with 413', async () => {
    const { svc } = build();
    const big = Buffer.concat([PDF, Buffer.alloc(PURCHASE_ATTACHMENT_MAX_BYTES)]);
    await expect(svc.upload('tenant-a', 'inv-a', file(big))).rejects.toBeInstanceOf(PayloadTooLargeException);
  });

  it('caps at 10 files per invoice', async () => {
    const { svc } = build();
    for (let i = 0; i < 10; i++) await svc.upload('tenant-a', 'inv-a', file(PDF));
    await expect(svc.upload('tenant-a', 'inv-a', file(PDF))).rejects.toBeInstanceOf(ConflictException);
    // another invoice is unaffected
    await expect(svc.upload('tenant-a', 'inv-a2', file(PDF))).resolves.toBeDefined();
  });

  it("returns 404 for another merchant's invoice and attachment ids", async () => {
    const { svc } = build();
    const { attachment } = await svc.upload('tenant-a', 'inv-a', file(PDF));
    await expect(svc.list('tenant-b', 'inv-a')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.upload('tenant-b', 'inv-a', file(PDF))).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.download('tenant-b', 'inv-a', attachment.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.remove('tenant-b', 'inv-a', attachment.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.pushToErp('tenant-b', 'inv-a', attachment.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.purchaseRecord('tenant-b', 'inv-a')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns 404 when the attachment id belongs to a different invoice of the same merchant', async () => {
    const { svc, store } = build();
    const { attachment } = await svc.upload('tenant-a', 'inv-a', file(PDF));
    await expect(svc.download('tenant-a', 'inv-a2', attachment.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.remove('tenant-a', 'inv-a2', attachment.id)).rejects.toBeInstanceOf(NotFoundException);
    expect(store).toHaveLength(1);
  });

  describe('ERP push', () => {
    it('refuses when the purchase is not synced', async () => {
      const { svc, attachToBill } = build({ synced: false });
      const { attachment } = await svc.upload('tenant-a', 'inv-a', file(PDF));
      await expect(svc.pushToErp('tenant-a', 'inv-a', attachment.id)).rejects.toBeInstanceOf(ConflictException);
      expect(attachToBill).not.toHaveBeenCalled();
    });

    it('records success, using the attachment id as the idempotency key', async () => {
      const { svc, attachToBill } = build({ synced: true });
      attachToBill.mockResolvedValue({ attachmentId: 'erp-att-9', billId: 'bill-1', syncStatus: 'synced' });
      const { attachment } = await svc.upload('tenant-a', 'inv-a', file(PDF));
      const out = await svc.pushToErp('tenant-a', 'inv-a', attachment.id);
      expect(out.erpPushStatus).toBe('synced');
      expect(attachToBill).toHaveBeenCalledWith('k', 'conn-1', 'bill-1', expect.objectContaining({ mime: 'application/pdf' }), { idempotencyKey: attachment.id });
    });

    it('keeps the file and records a failure so it can be retried', async () => {
      const { svc, attachToBill, store } = build({ synced: true });
      attachToBill.mockRejectedValueOnce(new MainApiHttpError(409, 'Bill not synced'));
      const { attachment } = await svc.upload('tenant-a', 'inv-a', file(PDF));
      const failed = await svc.pushToErp('tenant-a', 'inv-a', attachment.id);
      expect(failed.erpPushStatus).toBe('failed');
      expect(failed.erpPushError).toMatch(/cannot take this attachment/);
      expect(store).toHaveLength(1);
      attachToBill.mockResolvedValueOnce({ attachmentId: 'e', billId: 'bill-1', syncStatus: 'synced' });
      expect((await svc.pushToErp('tenant-a', 'inv-a', attachment.id)).erpPushStatus).toBe('synced');
    });

    it('records the main API\'s own failed syncStatus', async () => {
      const { svc, attachToBill } = build({ synced: true });
      attachToBill.mockResolvedValue({ attachmentId: 'e', billId: 'bill-1', syncStatus: 'failed', syncError: 'QuickBooks said no' });
      const { attachment } = await svc.upload('tenant-a', 'inv-a', file(PDF));
      const out = await svc.pushToErp('tenant-a', 'inv-a', attachment.id);
      expect(out).toMatchObject({ erpPushStatus: 'failed', erpPushError: 'QuickBooks said no' });
    });

    it('upload with pushToErp still succeeds when the push fails', async () => {
      const { svc, attachToBill } = build({ synced: true });
      attachToBill.mockRejectedValue(new MainApiHttpError(500, 'boom'));
      const res = await svc.upload('tenant-a', 'inv-a', file(PDF), { pushToErp: true });
      expect(res.attachment.erpPushStatus).toBe('failed');
      expect(res.pushError).toBeTruthy();
    });

    it('upload with pushToErp on an unsynced invoice succeeds and reports why not', async () => {
      const { svc } = build({ synced: false });
      const res = await svc.upload('tenant-a', 'inv-a', file(PDF), { pushToErp: true });
      expect(res.attachment.erpPushStatus).toBe('not_pushed');
      expect(res.pushError).toMatch(/Sync this purchase/);
    });
  });
});
