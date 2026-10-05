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
import {
  PurchaseBillMappingService,
  type ResolvedPurchaseBillMapping,
} from './purchase-bill-mapping.service';
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
  /** Marked to be sent to the ERP bill whenever the bill is synced or re-synced. */
  attachToErp: boolean;
  erpPushStatus: PurchaseAttachmentErpPushStatus;
  erpPushError: string | null;
}

export interface AttachmentPushWarning {
  attachmentId: string;
  filename: string;
  message: string;
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
  // A Content-Disposition value pasted into the name (e.g. `x.pdf; filename*=UTF-8''x.pdf`, which
  // some mail clients and download tools leave in saved filenames) -- keep only the real name.
  const unwrapped = (original || 'attachment').split(/;\s*filename\*?\s*=/i)[0];
  const base = unwrapped.split(/[\\/]/).pop() || 'attachment';
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
      attachToErp: a.attachToErp === true,
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
    options: {
      /** Mark the file for the ERP bill (sent now if the bill exists, otherwise when it is synced). */
      attachToErp?: boolean;
      /** Backward-compatible alias of `attachToErp`. */
      pushToErp?: boolean;
    } = {},
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

    const markForErp = (options.attachToErp ?? options.pushToErp) === true;
    const saved = await this.attachments.save(
      this.attachments.create({
        merchantId: invoice.merchantId,
        purchaseInvoiceId: invoice.id,
        filename: sanitiseFilename(file.originalname, detected.ext),
        mime: detected.mime,
        size: file.buffer.length,
        sha256: crypto.createHash('sha256').update(file.buffer).digest('hex'),
        content: file.buffer,
        attachToErp: markForErp,
        erpPushStatus: 'not_pushed',
        erpPushError: null,
        erpAttachmentId: null,
      }),
    );

    let pushError: string | null = null;
    let current = saved;
    // Only an already-synced bill can take the file now; otherwise the mark is just recorded and
    // the push happens when the bill is synced.
    if (markForErp && this.billExists(invoice)) {
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

  private billExists(invoice: PurchaseInvoiceOrmEntity): boolean {
    return invoice.erpSyncStatus === 'synced' && !!invoice.erpBillId;
  }

  /**
   * Flip the "send to the ERP bill" mark on an existing file. Turning it ON for an invoice whose
   * bill is already synced pushes the file now (an ERP failure is returned as `pushError`, the
   * mark is kept so a later sync retries). Turning it OFF only stops future automatic pushes: a
   * copy already attached to the ERP bill is NOT removed from the ERP.
   */
  async setAttachToErp(
    tenantId: string,
    purchaseId: string,
    attachmentId: string,
    attachToErp: boolean,
  ): Promise<{ attachment: PurchaseAttachmentDto; pushError: string | null }> {
    const invoice = await this.requireInvoice(tenantId, purchaseId);
    const att = await this.requireAttachment(invoice, attachmentId);
    await this.attachments.update(
      { id: att.id, merchantId: invoice.merchantId, purchaseInvoiceId: invoice.id },
      { attachToErp },
    );
    att.attachToErp = attachToErp;

    let current = att;
    let pushError: string | null = null;
    if (attachToErp && this.billExists(invoice) && att.erpPushStatus !== 'synced') {
      try {
        current = await this.pushRecord(tenantId, invoice, att.id);
        pushError = current.erpPushStatus === 'failed' ? current.erpPushError : null;
      } catch (err) {
        pushError = err instanceof Error ? err.message : 'Could not push to the ERP.';
      }
    }
    return { attachment: this.toDto(current), pushError };
  }

  /**
   * Pushes every file of this invoice that is marked for the ERP and not yet there. Called after
   * a bill is created or re-synced. NEVER throws: the bill sync has already succeeded and must
   * stay so; each failure is recorded on its attachment and returned as a warning. Sequential and
   * bounded by the per-invoice file cap; one failure does not stop the rest. Replay-safe because
   * the idempotency key sent to the ERP is the attachment id.
   */
  async pushFlaggedForInvoice(
    tenantId: string,
    invoice: PurchaseInvoiceOrmEntity,
    resolved?: Pick<ResolvedPurchaseBillMapping, 'mainApiApiKey' | 'connectionId'>,
  ): Promise<AttachmentPushWarning[]> {
    const warnings: AttachmentPushWarning[] = [];
    try {
      const rows = await this.attachments.find({
        where: {
          merchantId: invoice.merchantId,
          purchaseInvoiceId: invoice.id,
          attachToErp: true,
        },
        order: { createdAt: 'ASC' },
        take: PURCHASE_ATTACHMENT_MAX_FILES,
      });
      for (const row of rows) {
        if (row.erpPushStatus === 'synced') continue;
        try {
          const done = await this.pushRecord(tenantId, invoice, row.id, resolved);
          if (done.erpPushStatus === 'failed') {
            warnings.push({
              attachmentId: row.id,
              filename: row.filename,
              message: done.erpPushError ?? 'The accounting system rejected the attachment.',
            });
          }
        } catch (err) {
          warnings.push({
            attachmentId: row.id,
            filename: row.filename,
            message: err instanceof Error ? err.message : 'Could not push to the ERP.',
          });
        }
      }
    } catch (err) {
      this.logger.warn(
        `Could not push flagged attachments for purchase ${invoice.id}: ${err instanceof Error ? err.name : 'error'}`,
      );
      warnings.push({
        attachmentId: '',
        filename: '',
        message: 'Attachments could not be sent to the accounting system. Retry from the attachment list.',
      });
    }
    return warnings;
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
    preResolved?: Pick<ResolvedPurchaseBillMapping, 'mainApiApiKey' | 'connectionId'>,
  ): Promise<PurchaseInvoiceAttachmentOrmEntity> {
    const att = await this.requireAttachment(invoice, attachmentId, true);
    if (invoice.erpSyncStatus !== 'synced' || !invoice.erpBillId) {
      throw new ConflictException(
        'Sync this purchase to your accounting system before attaching files to its bill.',
      );
    }
    const resolved =
      preResolved ?? (await this.billMapping.resolveForSync(tenantId, invoice.merchantId));
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
