import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import type { Response } from 'express';
import { InsufficientStockError } from '../../../inventory/domain/errors/insufficient-stock.error';
import { SalesService } from '../../../sales/application/sales.service';
import { ItemNotReadyForEtimsError } from '../../../sales/domain/errors/item-not-ready-for-etims.error';
import { round2 } from '../../../regulatory/oscu/mapping/oscu-tax-rates';
import { ComplianceStatus } from '../../../shared/domain/enums/compliance-status.enum';
import { DocumentType } from '../../../shared/domain/enums/document-type.enum';
import { SourceSystem } from '../../../shared/domain/enums/source-system.enum';
import { V1ScopeService } from '../../application/v1-scope.service';
import { ApiKeyScope } from '../../domain/api-key-scope.enum';
import { RequiredApiTenantId } from '../../infrastructure/decorators/api-caller.decorator';
import { IdempotencyKey } from '../../infrastructure/decorators/idempotency-key.decorator';
import { RequireScopes } from '../../infrastructure/decorators/require-scopes.decorator';
import { V1Api } from './v1-api.decorator';
import {
  objectAt,
  optionalString,
  readBody,
  readPageSize,
  requiredArray,
  requiredDate,
  requiredNumber,
  requiredString,
  withIndex,
} from './v1-input';
import { toV1Sale, type V1Sale } from './v1-views';

const MAX_LINES = 200;
/** OSCU rfdRsnCd: 01 missing quantity, 02 missing data, 03 damaged, 04 wasted, 05 shortage, 06 refund. */
const CREDIT_NOTE_REASONS = ['01', '02', '03', '04', '05', '06'] as const;
/** OSCU pmtTyCd 01 cash, 02 credit, 03 cash/credit, 04 bank cheque, 05 debit/credit card, 06 mobile money, 07 other. */
const DEFAULT_PAYMENT_TYPE = '01';
/** OSCU salesSttsCd 02: approved. The API only issues completed sales. */
const APPROVED_SALE_STATUS = '02';

@Controller('v1')
@V1Api()
export class V1SalesController {
  constructor(
    private readonly sales: SalesService,
    private readonly scope: V1ScopeService,
  ) {}

  // ─── Sales ──────────────────────────────────────────────────────────────

  @Post('sales')
  @RequireScopes(ApiKeyScope.SALES_WRITE)
  @ApiOperation({
    summary:
      'Issue a sale: validated, submitted to KRA, and answered with the signed receipt. Send an Idempotency-Key so a retried request cannot file a second invoice.',
  })
  async createSale(
    @RequiredApiTenantId() tenantId: string,
    @Body() rawBody: unknown,
    @IdempotencyKey() idempotencyKey: string | null,
    @Res({ passthrough: true }) res: Response,
  ) {
    const body = readBody(rawBody);
    const merchantId = await this.scope.merchantIdFor(tenantId);

    const traderInvoiceNumber = requiredString(body, 'traderInvoiceNumber', {
      max: 50,
    });
    const saleDate = requiredDate(body, 'saleDate');
    const rawLines = requiredArray(body, 'lines', { min: 1, max: MAX_LINES });
    const lines = rawLines.map((_, index) =>
      withIndex('lines', index, () => {
        const line = objectAt(rawLines, index, 'lines');
        return {
          itemId: requiredString(line, 'itemId'),
          quantity: requiredNumber(line, 'quantity', { exclusiveMin: 0 }),
          unitPrice: requiredNumber(line, 'unitPrice', { min: 0 }),
          description: optionalString(line, 'description', { max: 200 }),
        };
      }),
    );
    const customer = readCustomer(body);
    const paymentTypeCode =
      optionalString(body, 'paymentTypeCode', { max: 2 }) ??
      DEFAULT_PAYMENT_TYPE;

    // Every id below is resolved against the business the guard bound. This is
    // the check createDocument does not make: it will happily snapshot another
    // business's item onto this business's sale.
    const items = await this.scope.requireItems(
      merchantId,
      lines.map((l) => l.itemId),
    );
    const branch = await this.scope.resolveBranch(
      tenantId,
      optionalString(body, 'branchId'),
    );

    const sourceDocumentId = idempotencyKey ?? traderInvoiceNumber;
    const existing = await this.sales.findSaleByTraderNumber(
      merchantId,
      traderInvoiceNumber,
    );
    if (existing && existing.sourceDocumentId !== sourceDocumentId) {
      throw new ConflictException(
        `A sale with traderInvoiceNumber ${traderInvoiceNumber} already exists. Use a new number, or repeat the original request with its original Idempotency-Key.`,
      );
    }

    // Prices are tax-inclusive. The document is stored the way the verified
    // dashboard path stores it -- `taxAmount` 0 on every line, so that
    // subtotal = total = sum(quantity x unitPrice) -- because the structural
    // validator's convention is `total = subtotal + tax` and its subtotal is the
    // sum of the line totals. Splitting VAT out of an inclusive price here (as
    // this code first did) makes that check fail: 10,000 subtotal against
    // 11,600 of lines. Nothing is lost: the OSCU request, the receipt and the
    // sale report all derive the VAT split from each line's tax type, so KRA
    // and the customer both see the correct figures.
    const priced = lines.map((l) => {
      const item = items.get(l.itemId)!;
      return {
        itemId: l.itemId,
        description: l.description ?? '',
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        // From the item, never the caller: a caller-chosen category is a
        // caller-chosen tax rate on a fiscal document.
        taxCategory: item.taxCategory,
        taxAmount: 0,
        total: round2(l.quantity * l.unitPrice),
      };
    });
    const totalAmount = round2(priced.reduce((s, l) => s + l.total, 0));

    const created = await this.sales.createDocument(
      {
        merchantId,
        branchId: branch.id,
        sourceSystem: SourceSystem.API,
        sourceDocumentId,
        documentType: DocumentType.SALE,
        documentNumber: traderInvoiceNumber,
        originalDocumentNumber: null,
        originalSaleId: null,
        saleDate,
        receiptTypeCode: 'S',
        paymentTypeCode,
        invoiceStatusCode: APPROVED_SALE_STATUS,
        currency: 'KES',
        exchangeRate: 1,
        subtotalAmount: totalAmount,
        totalTax: 0,
        totalAmount,
        customerPin: customer.pin ?? null,
        customerId: null,
        customerName: customer.name ?? null,
        customerPhoneNumber: customer.phone ?? null,
        customerEmail: customer.email ?? null,
        lines: priced.map(({ total: _total, ...line }) => line),
      },
      { enqueueProcessing: false },
    );

    const documentId = created.document.id;
    if (!created.created) {
      // Same key, same number: hand back what already exists. Deliberately no
      // resubmission -- a replay must be safe to send blindly. A failed one is
      // re-driven explicitly with POST /v1/sales/{id}/retry.
      res.setHeader('Idempotent-Replayed', 'true');
      res.status(200);
      return { data: { sale: await this.saleView(documentId) } };
    }

    await this.runPipeline(documentId);
    return this.respondToOutcome(documentId, res);
  }

  @Get('sales')
  @RequireScopes(ApiKeyScope.SALES_READ)
  @ApiOperation({ summary: 'List sales and credit notes, newest first' })
  async listSales(
    @RequiredApiTenantId() tenantId: string,
    @Query('cursor') cursor?: string,
    @Query('pageSize') pageSize?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const merchantId = await this.scope.merchantIdFor(tenantId);
    if (cursor) {
      // The cursor is a document id, and the repository resolves it by id
      // alone. Verifying it belongs to this business closes it as a way to
      // probe for other businesses' documents.
      await this.scope.requireSale(merchantId, cursor);
    }

    const page = await this.sales.listNormalizedSaleReports({
      merchantId,
      before: cursor || undefined,
      startDate: startDate ? isoOrThrow(startDate, 'startDate') : undefined,
      endDate: endDate ? isoOrThrow(endDate, 'endDate') : undefined,
      pageSize: readPageSize(pageSize),
    });

    return {
      data: { sales: page.data.map(toV1Sale) },
      pagination: {
        nextCursor: page.pagination.next,
        pageSize: page.pagination.pageSize,
      },
    };
  }

  @Get('sales/:id')
  @RequireScopes(ApiKeyScope.SALES_READ)
  @ApiOperation({ summary: 'One sale or credit note' })
  async getSale(
    @RequiredApiTenantId() tenantId: string,
    @Param('id') id: string,
  ) {
    const merchantId = await this.scope.merchantIdFor(tenantId);
    await this.scope.requireSale(merchantId, id);
    return { data: { sale: await this.saleView(id) } };
  }

  @Get('sales/:id/receipt')
  @RequireScopes(ApiKeyScope.SALES_READ)
  @ApiOperation({
    summary:
      'The KRA receipt as a PDF. Pass copy=true for a customer copy, marked COPY per TIS §11.',
  })
  async getReceipt(
    @RequiredApiTenantId() tenantId: string,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
    @Query('copy') copy?: string,
  ) {
    const merchantId = await this.scope.merchantIdFor(tenantId);
    await this.scope.requireSale(merchantId, id);

    const isCopy = copy === 'true';
    const pdf = await this.sales.getEtimsReceiptPdf(id, { copy: isCopy });
    if (!pdf) {
      throw new NotFoundException(
        'No receipt yet: KRA has not accepted this sale.',
      );
    }
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="receipt-${isCopy ? 'copy-' : ''}${id}.pdf"`,
    });
    return new StreamableFile(pdf);
  }

  @Post('sales/:id/retry')
  @HttpCode(200)
  @RequireScopes(ApiKeyScope.SALES_WRITE)
  @ApiOperation({
    summary:
      'Re-submit a sale or credit note that did not reach KRA, or that KRA rejected.',
  })
  async retrySale(
    @RequiredApiTenantId() tenantId: string,
    @Param('id') id: string,
  ) {
    const merchantId = await this.scope.merchantIdFor(tenantId);
    await this.scope.requireSale(merchantId, id);

    // Always the one owned id. retrySales treats an omitted documentIds as
    // "every retryable document for this business", which is never what a
    // caller naming one sale means.
    await this.sales.retrySales({ merchantId, documentIds: [id] });

    const sale = await this.saleView(id);
    if (sale.status === 'failed') {
      throw new UnprocessableEntityException({
        code: 'kra_rejected',
        message: sale.error ?? 'KRA rejected this document',
        sale,
      });
    }
    return { data: { sale } };
  }

  // ─── Credit notes ───────────────────────────────────────────────────────

  @Post('credit-notes')
  @RequireScopes(ApiKeyScope.SALES_WRITE)
  @ApiOperation({
    summary:
      'Issue a credit note reversing an accepted sale in full. Send an Idempotency-Key.',
  })
  async createCreditNote(
    @RequiredApiTenantId() tenantId: string,
    @Body() rawBody: unknown,
    @IdempotencyKey() idempotencyKey: string | null,
    @Res({ passthrough: true }) res: Response,
  ) {
    const body = readBody(rawBody);
    const merchantId = await this.scope.merchantIdFor(tenantId);

    const traderInvoiceNumber = requiredString(body, 'traderInvoiceNumber', {
      max: 50,
    });
    const returnDate = requiredDate(body, 'returnDate');
    const reason = optionalString(body, 'reason') ?? '06';
    if (!(CREDIT_NOTE_REASONS as readonly string[]).includes(reason)) {
      throw new BadRequestException(
        `reason must be one of: ${CREDIT_NOTE_REASONS.join(', ')}`,
      );
    }

    // Resolved against this business: a sale id from anywhere else is a 404.
    const original = await this.scope.requireSale(
      merchantId,
      requiredString(body, 'saleId'),
    );
    if (original.documentType !== DocumentType.SALE) {
      throw new UnprocessableEntityException({
        code: 'not_a_sale',
        message: 'A credit note can only reverse a sale, not another credit note.',
      });
    }
    if (original.complianceStatus !== ComplianceStatus.ACCEPTED) {
      throw new UnprocessableEntityException({
        code: 'sale_not_accepted',
        message:
          'Only a sale KRA has accepted can be credited. Retry or fix the sale first.',
      });
    }

    // Mirrors the original line for line, in the same convention it was stored
    // in, so the structural check (total = subtotal + tax) holds whether the
    // sale came through this API or another path.
    const priced = original.lines.map((l) => ({
      itemId: l.itemId,
      description: l.description,
      quantity: Math.abs(l.quantity),
      unitPrice: l.unitPrice,
      taxCategory: l.taxCategory,
      taxAmount: Math.abs(l.taxAmount),
      total: round2(Math.abs(l.quantity) * l.unitPrice),
    }));
    const subtotalAmount = round2(priced.reduce((s, l) => s + l.total, 0));
    const totalTax = round2(priced.reduce((s, l) => s + l.taxAmount, 0));

    const created = await this.sales.createDocument(
      {
        merchantId,
        branchId: original.branchId,
        sourceSystem: SourceSystem.API,
        sourceDocumentId: idempotencyKey ?? traderInvoiceNumber,
        documentType: DocumentType.CREDIT_NOTE,
        documentNumber: traderInvoiceNumber,
        originalDocumentNumber: original.documentNumber,
        originalSaleId: original.id,
        saleDate: returnDate,
        // OSCU rfdDt and rfdRsnCd are both required on a credit note; KRA
        // rejects a missing one with "Missing RfdDt Date" / "Invalid RfdRsnCd".
        creditNoteDate: returnDate,
        creditNoteReasonCode: reason,
        receiptTypeCode: 'R',
        paymentTypeCode: original.paymentTypeCode ?? DEFAULT_PAYMENT_TYPE,
        invoiceStatusCode: original.invoiceStatusCode ?? APPROVED_SALE_STATUS,
        currency: original.currency,
        exchangeRate: original.exchangeRate,
        subtotalAmount,
        totalTax,
        totalAmount: round2(subtotalAmount + totalTax),
        customerPin: original.customerPin,
        // KRA NPEs on a credit note whose custNm is null, and rejects one that
        // does not match the sale's -- carry the buyer over from the original.
        customerId: original.customerId,
        customerName: original.customerName,
        customerPhoneNumber: original.customerPhoneNumber,
        customerEmail: original.customerEmail,
        lines: priced.map(({ total: _total, ...line }) => line),
      },
      { enqueueProcessing: false },
    );

    const documentId = created.document.id;
    if (!created.created) {
      res.setHeader('Idempotent-Replayed', 'true');
      res.status(200);
      return { data: { sale: await this.saleView(documentId) } };
    }

    await this.runPipeline(documentId);
    return this.respondToOutcome(documentId, res);
  }

  // ─── helpers ────────────────────────────────────────────────────────────

  private async saleView(documentId: string): Promise<V1Sale> {
    return toV1Sale(await this.sales.getNormalizedSaleReport(documentId));
  }

  /**
   * Validate -> prepare -> submit, and turn each way it can stop short into an
   * error that still names the sale. The document exists from the moment
   * createDocument returns, so a caller told only "validation failed" would
   * have a draft they cannot see and cannot retry.
   */
  private async runPipeline(documentId: string): Promise<void> {
    try {
      await this.sales.submitDraftDocument(documentId);
    } catch (error) {
      const sale = await this.saleView(documentId);
      if (error instanceof BadRequestException) {
        const response = error.getResponse() as {
          message?: string;
          errors?: unknown;
        };
        throw new UnprocessableEntityException({
          code: 'validation_failed',
          message: response.message ?? 'Validation failed',
          errors: response.errors ?? [],
          sale,
        });
      }
      if (error instanceof ItemNotReadyForEtimsError) {
        throw new UnprocessableEntityException({
          code: 'item_not_registered',
          message: `${error.message} Register the item with KRA (POST /v1/items/{id}/register), then POST /v1/sales/${documentId}/retry.`,
          sale,
        });
      }
      if (error instanceof InsufficientStockError) {
        throw new ConflictException({
          code: 'insufficient_stock',
          message: error.message,
          sale,
        });
      }
      throw error;
    }
  }

  /**
   * KRA's verdict is a status on the document, not an exception, so the HTTP
   * status is decided here: 201 accepted; 422 rejected or failed (never a 2xx
   * for a fiscal document KRA refused); 202 for anything still in flight.
   */
  private async respondToOutcome(documentId: string, res: Response) {
    const sale = await this.saleView(documentId);
    if (sale.status === 'completed') {
      res.status(201);
      return { data: { sale } };
    }
    if (sale.status === 'failed') {
      throw new UnprocessableEntityException({
        code: 'kra_rejected',
        message: sale.error ?? 'KRA rejected this document',
        sale,
      });
    }
    res.status(202);
    return { data: { sale } };
  }
}

function readCustomer(body: Record<string, unknown>) {
  const raw = body.customer;
  if (raw === undefined || raw === null) return {} as Record<string, string | undefined>;
  const customer = readBody(raw);
  return {
    name: optionalString(customer, 'name', { max: 200 }),
    pin: optionalString(customer, 'pin', { max: 11 }),
    phone: optionalString(customer, 'phone', { max: 30 }),
    email: optionalString(customer, 'email', { max: 200 }),
  };
}

function isoOrThrow(value: string, field: string): string {
  return requiredDate({ [field]: value }, field);
}

