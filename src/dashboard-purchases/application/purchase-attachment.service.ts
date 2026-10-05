import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as crypto from 'crypto';
import { Repository } from 'typeorm';
import { MainApiConnectionApplicationService } from '../../integration/main-api-pull/application/main-api-connection.application.service';
import {
  MainApiHttpError,
  MainApiPullClient,
} from '../../integration/main-api-pull/infrastructure/http/main-api-pull.client';
import { PurchaseInvoiceOrmEntity } from '../infrastructure/persistence/purchase-invoice.orm-entity';
import {
  PurchaseAttachmentErpPushStatus,
  PurchaseInvoiceAttachmentOrmEntity,
} from '../infrastructure/persistence/purchase-invoice-attachment.orm-entity';
import { PurchaseBillMappingService } from './purchase-bill-mapping.service';
import { generatePurchaseRecordPdf } from './purchase-record/purchase-record-pdf.generator';

export const PURCHASE_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const PURCHASE_ATTACHMENT_MAX_FILES = 10;

export interface UploadedFileLike {
  originalname?: string;
  buffer?: Buffer;
  size?: number;
}

export interface PurchaseAttachmentDto {
  id: string;
  purchaseInvoiceId: string;
  filename: string;
  mime: string;
  size: number;
  createdAt: Date;
  erpPushStatus: PurchaseAttachmentErpPushStatus;
  erpPushError: string | null;
}

/** Detects pdf/jpg/png from magic bytes only -- the client-declared type is never trusted. */
export function detectFileType(buf: Buffer): { mime: string; ext: string } | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') {
    return { mime: 'application/pdf', ext: 'pdf' };
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { mime: 'image/png', ext: 'png' };
  }
  return null;
}

/** Strips any path, restricts to a safe charset, bounds the length and forces the detected extension. */
export function sanitiseFilename(original: string | undefined, ext: string): string {
  const base = (original || 'attachment').split(/[\\/]/).pop() || 'attachment';
  const stem = base.replace(/\.[^.]*$/, '');
  const cleaned = stem
    .replace(/[^A-Za-z0-9._ -]/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^[.\s-]+/, '')
    .slice(0, 100)
    .trim();
  return `${cleaned || 'attachment'}.${ext}`;
}

export function describeErpPushError(err: unknown): string {
  if (err instanceof MainApiHttpError) {
    switch (err.status) {
      case 404:
        return 'The bill was not found in your accounting system connection. Re-sync the purchase and try again.';
      case 409:
        return `Your accounting system cannot take this attachment yet: ${err.message || 'the bill is not synced or the integration does not support attachments'}.`;
      case 413:
        return 'The accounting system rejected the file as too large (10 MB maximum).';
      case 415:
        return 'The accounting system rejected the file type (PDF, JPG or PNG only).';
      default:
        return `The accounting system could not be reached (error ${err.status}). Try again shortly.`;
    }
  }
  return 'The accounting system could not be reached. Try again shortly.';
}

@Injectable()
export class PurchaseAttachmentService {
  private readonly logger = new Logger(PurchaseAttachmentService.name);

  constructor(
    @InjectRepository(PurchaseInvoiceOrmEntity)
    private readonly purchases: Repository<PurchaseInvoiceOrmEntity>,
    @InjectRepository(PurchaseInvoiceAttachmentOrmEntity)
    private readonly attachments: Repository<PurchaseInvoiceAttachmentOrmEntity>,
    private readonly mainApiConnections: MainApiConnectionApplicationService,
    private readonly mainApiPull: MainApiPullClient,
    private readonly billMapping: PurchaseBillMappingService,
  ) {}

  /** The IDOR boundary: an invoice is only ever found through the caller's own merchant. */
  private async requireInvoice(
    tenantId: string,
    purchaseId: string,
  ): Promise<PurchaseInvoiceOrmEntity> {
    const merchantId = await this.mainApiConnections.resolveMerchantId(tenantId);
    const row = await this.purchases.findOne({
      where: { id: purchaseId, merchantId },
    });
    if (!row) throw new NotFoundException('Purchase invoice not found');
    return row;
  }

  private async requireAttachment(
    invoice: PurchaseInvoiceOrmEntity,
    attachmentId: string,
    withContent = false,
  ): Promise<PurchaseInvoiceAttachmentOrmEntity> {
    const qb = this.attachments
      .createQueryBuilder('a')
      .where('a.id = :attachmentId', { attachmentId })
      .andWhere('a.merchantId = :merchantId', { merchantId: invoice.merchantId })
      .andWhere('a.purchaseInvoiceId = :purchaseInvoiceId', {
        purchaseInvoiceId: invoice.id,
      });
    if (withContent) qb.addSelect('a.content');
    const att = await qb.getOne();
    if (!att) throw new NotFoundException('Attachment not found');
    return att;
  }

  private toDto(a: PurchaseInvoiceAttachmentOrmEntity): PurchaseAttachmentDto {
    return {
      id: a.id,
      purchaseInvoiceId: a.purchaseInvoiceId,
      filename: a.filename,
      mime: a.mime,
      size: a.size,
      createdAt: a.createdAt,
      erpPushStatus: a.erpPushStatus,
      erpPushError: a.erpPushError,
    };
  }

  async list(tenantId: string, purchaseId: string): Promise<PurchaseAttachmentDto[]> {
    const invoice = await this.requireInvoice(tenantId, purchaseId);
    const rows = await this.attachments.find({
      where: { merchantId: invoice.merchantId, purchaseInvoiceId: invoice.id },
      order: { createdAt: 'ASC' },
    });
    return rows.map((r) => this.toDto(r));
  }

  async upload(
    tenantId: string,
    purchaseId: string,
    file: UploadedFileLike | undefined,
    options: { pushToErp?: boolean } = {},
  ): Promise<{ attachment: PurchaseAttachmentDto; pushError: string | null }> {
    const invoice = await this.requireInvoice(tenantId, purchaseId);
    if (!file?.buffer || file.buffer.length === 0) {
      throw new BadRequestException('Choose a file to upload (form field "file").');
    }
    if (file.buffer.length > PURCHASE_ATTACHMENT_MAX_BYTES) {
      throw new PayloadTooLargeException('File is larger than 10 MB.');
    }
    const detected = detectFileType(file.buffer);
    if (!detected) {
      throw new UnsupportedMediaTypeException(
        'Only PDF, JPG and PNG files are accepted, and the file content must match.',
      );
    }
    const existing = await this.attachments.count({
      where: { merchantId: invoice.merchantId, purchaseInvoiceId: invoice.id },
    });
    if (existing >= PURCHASE_ATTACHMENT_MAX_FILES) {
      throw new ConflictException(
        `An invoice can have at most ${PURCHASE_ATTACHMENT_MAX_FILES} attachments. Delete one first.`,
      );
    }

    const saved = await this.attachments.save(
      this.attachments.create({
        merchantId: invoice.merchantId,
        purchaseInvoiceId: invoice.id,
        filename: sanitiseFilename(file.originalname, detected.ext),
        mime: detected.mime,
        size: file.buffer.length,
        sha256: crypto.createHash('sha256').update(file.buffer).digest('hex'),
        content: file.buffer,
        erpPushStatus: 'not_pushed',
        erpPushError: null,
        erpAttachmentId: null,
      }),
    );

    let pushError: string | null = null;
    let current = saved;
    if (options.pushToErp) {
      try {
        current = await this.pushRecord(tenantId, invoice, saved.id);
        pushError = current.erpPushStatus === 'failed' ? current.erpPushError : null;
      } catch (err) {
        // The upload itself succeeded; report why the ERP step could not start.
        pushError = err instanceof Error ? err.message : 'Could not push to the ERP.';
      }
    }
    return { attachment: this.toDto(current), pushError };
  }

  async download(
    tenantId: string,
    purchaseId: string,
    attachmentId: string,
  ): Promise<{ filename: string; mime: string; content: Buffer }> {
    const invoice = await this.requireInvoice(tenantId, purchaseId);
    const a = await this.requireAttachment(invoice, attachmentId, true);
    return { filename: a.filename, mime: a.mime, content: a.content };
  }

  async remove(tenantId: string, purchaseId: string, attachmentId: string): Promise<void> {
    const invoice = await this.requireInvoice(tenantId, purchaseId);
    const a = await this.requireAttachment(invoice, attachmentId);
    await this.attachments.delete({
      id: a.id,
      merchantId: invoice.merchantId,
      purchaseInvoiceId: invoice.id,
    });
  }

  async pushToErp(
    tenantId: string,
    purchaseId: string,
    attachmentId: string,
  ): Promise<PurchaseAttachmentDto> {
    const invoice = await this.requireInvoice(tenantId, purchaseId);
    return this.toDto(await this.pushRecord(tenantId, invoice, attachmentId));
  }

  /** Throws for unmet preconditions (nothing recorded); records and returns `failed` for ERP-side failures. */
  private async pushRecord(
    tenantId: string,
    invoice: PurchaseInvoiceOrmEntity,
    attachmentId: string,
  ): Promise<PurchaseInvoiceAttachmentOrmEntity> {
    const att = await this.requireAttachment(invoice, attachmentId, true);
    if (invoice.erpSyncStatus !== 'synced' || !invoice.erpBillId) {
      throw new ConflictException(
        'Sync this purchase to your accounting system before attaching files to its bill.',
      );
    }
    const resolved = await this.billMapping.resolveForSync(tenantId, invoice.merchantId);
    if (!resolved) {
      throw new ConflictException('No connected accounting system for this business.');
    }

    att.erpPushStatus = 'syncing';
    att.erpPushError = null;
    await this.attachments.update({ id: att.id }, { erpPushStatus: 'syncing', erpPushError: null });
    try {
      const res = await this.mainApiPull.attachToBill(
        resolved.mainApiApiKey,
        resolved.connectionId,
        invoice.erpBillId,
        { buffer: att.content, filename: att.filename, mime: att.mime },
        { idempotencyKey: att.id },
      );
      att.erpPushStatus = res.syncStatus;
      att.erpPushError = res.syncStatus === 'failed' ? (res.syncError ?? 'The accounting system rejected the attachment.') : null;
      att.erpAttachmentId = res.attachmentId ?? null;
    } catch (err) {
      this.logger.warn(
        `ERP attachment push failed for purchase ${invoice.id}: ${err instanceof MainApiHttpError ? err.status : 'network'}`,
      );
      att.erpPushStatus = 'failed';
      att.erpPushError = describeErpPushError(err);
    }
    await this.attachments.update(
      { id: att.id },
      {
        erpPushStatus: att.erpPushStatus,
        erpPushError: att.erpPushError,
        erpAttachmentId: att.erpAttachmentId,
      },
    );
    return att;
  }

  async purchaseRecord(
    tenantId: string,
    purchaseId: string,
  ): Promise<{ filename: string; content: Buffer }> {
    const invoice = await this.requireInvoice(tenantId, purchaseId);
    const content = await generatePurchaseRecordPdf(invoice);
    const ref = (invoice.spplrInvcNo ?? invoice.receiptNo ?? invoice.id).replace(/[^A-Za-z0-9._-]/g, '_');
    return { filename: `purchase-record-${ref}.pdf`, content };
  }
}
