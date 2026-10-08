import { resolveLineDiscount } from '../../shared/utils/line-discount';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import {
  ApiBadRequestResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SalesService } from '../application/sales.service';
import { CreateSaleDto } from './dto/create-sale.dto';
import { DocumentType } from '../../shared/domain/enums/document-type.enum';
import { InvoiceType } from '../../shared/domain/enums/invoice-type.enum';
import {
  applyInvoiceTypeOverride,
  findItemsNotRegisteredExempt,
} from '../domain/utils/invoice-type.util';
import { CatalogService } from '../../catalog/api/catalog.service';
import { SourceSystem } from '../../shared/domain/enums/source-system.enum';
import {
  SalesReportDetailResponseDto,
  SalesReportListResponseDto,
} from './dto/sales-report.dto';
import { CreateExpressCreditNoteDto } from './dto/create-express-credit-note.dto';
import { ResyncOscuSequenceDto } from './dto/resync-oscu-sequence.dto';
import { ComplianceStatus } from '../../shared/domain/enums/compliance-status.enum';
import { ComplianceServiceAuthGuard } from '../../integration/compliance-service-auth.guard';
import { AssertedMerchantGuard } from '../../integration/asserted-merchant.guard';
import { PlatformOscuCallbackService } from '../../integration/platform-outbound/platform-oscu-callback.service';
import { Sync2BooksCorrelationPersistenceService } from '../../integration/platform-outbound/sync2books-correlation-persistence.service';
import { parseSync2BooksCorrelation } from '../../integration/platform-outbound/sync2books-request-headers.util';
import { ItemNotReadyForEtimsError } from '../domain/errors/item-not-ready-for-etims.error';

@Controller('api/sales')
@ApiTags('API Sales')
@UseGuards(ComplianceServiceAuthGuard, AssertedMerchantGuard)
export class ApiSalesController {
  constructor(
    private readonly salesService: SalesService,
    private readonly oscuCallback: PlatformOscuCallbackService,
    private readonly correlationPersistence: Sync2BooksCorrelationPersistenceService,
    private readonly catalog: CatalogService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List sales (Digitax-like report)' })
  @ApiResponse({
    status: 200,
    description: 'Sales report list',
    type: SalesReportListResponseDto,
  })
  async listSales(
    @Query('merchantId') merchantId: string,
    @Query('before') before?: string,
    @Query('after') after?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<SalesReportListResponseDto> {
    return this.salesService.listNormalizedSaleReports({
      merchantId,
      startDate,
      endDate,
      before,
      after,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Post()
  @ApiOperation({ summary: 'Create a sale (Digitax-like)' })
  @ApiResponse({
    status: 201,
    description: 'Sale created',
    type: SalesReportDetailResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  async createSale(
    @Body() body: CreateSaleDto,
    @Req() req: Request,
    @Query('submit') submit?: string,
  ): Promise<SalesReportDetailResponseDto> {
    const shouldSubmit = submit === undefined ? true : submit !== 'false';
    const docType =
      body.receiptTypeCode === 'R'
        ? DocumentType.CREDIT_NOTE
        : DocumentType.SALE;
    const invoiceType = body.invoiceType ?? InvoiceType.NORMAL;
    if (invoiceType === InvoiceType.EXEMPT) {
      await this.assertItemsAreExemptEligible(body.items.map((i) => i.id));
    }

    const normalizeForCreditNote = docType === DocumentType.CREDIT_NOTE;
    const normalizedItems = normalizeForCreditNote
      ? body.items.map((i) => ({
          ...i,
          quantity: Math.abs(i.quantity),
          taxAmount: Math.abs(i.taxAmount),
        }))
      : body.items;
    // Runs last, after every other normalization, so a tax-exempt sale can
    // never carry a line the client computed at a real VAT rate -- see
    // applyInvoiceTypeOverride's doc comment.
    const items = applyInvoiceTypeOverride(normalizedItems, invoiceType);

    const createResult = await this.salesService.createDocument(
      {
        merchantId: body.merchantId,
        branchId: body.branchId,
        sourceSystem: SourceSystem.API,
        sourceDocumentId: body.traderInvoiceNumber,
        documentType: docType,
        documentNumber: body.traderInvoiceNumber,
        originalDocumentNumber: body.originalTraderInvoiceNumber ?? null,
        creditNoteDate: asNullableString(body.creditNoteDate),
        creditNoteReasonCode: asNullableString(body.creditNoteReasonCode),
        originalSaleId: null,
        saleDate: body.saleDate,
        receiptTypeCode: body.receiptTypeCode,
        paymentTypeCode: body.paymentTypeCode,
        invoiceStatusCode: body.invoiceStatusCode,
        invoiceType,
        currency: 'KES',
        exchangeRate: 1,
        subtotalAmount: items.reduce(
          (sum, i) =>
            sum + resolveLineDiscount(i.quantity, i.unitPrice, i.discountRate, i.discountAmount).net,
          0,
        ),
        totalTax: items.reduce((sum, i) => sum + i.taxAmount, 0),
        totalAmount: items.reduce(
          (sum, i) =>
            sum + resolveLineDiscount(i.quantity, i.unitPrice, i.discountRate, i.discountAmount).net + i.taxAmount,
          0,
        ),
        customerPin: body.customerTin ?? null,
        // Same as the dashboard route: without these the receipt's Buyer Details is
        // blank and a credit note is rejected by KRA (custNm null NPE, live 2026-09-17).
        customerId: body.customerId ?? null,
        customerName: body.customerName ?? null,
        customerPhoneNumber: body.customerPhoneNumber ?? null,
        customerEmail: body.customerEmail ?? null,
        lines: items.map((i) => ({
          itemId: i.id,
          description: i.itemDescription ?? '',
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          taxCategory: i.taxCategory,
          taxAmount: i.taxAmount,
          discountRate: i.discountRate,
          discountAmount: i.discountAmount,
          // Set only when applyInvoiceTypeOverride forced EXEMPT above;
          // undefined otherwise, so a normal sale still falls back to the
          // item's own catalog taxTyCd exactly as before this field existed.
          taxTyCdSnapshot: i.taxTyCdSnapshot,
        })),
      },
      { enqueueProcessing: false },
    );

    const documentId = createResult.document.id;

    // If this is a newly-created document and submit is enabled, run the pipeline
    // synchronously for dev API ergonomics. Otherwise (idempotent replay or
    // submit=false), just return the normalized document view.
    if (createResult.created && shouldSubmit) {
      await this.salesService.submitDraftDocument(documentId);

      const corr = parseSync2BooksCorrelation(req);
      if (corr) {
        await this.correlationPersistence.patchComplianceDocument(
          documentId,
          corr,
        );
        await this.oscuCallback.postOutcomeWithCorrelation(corr, {
          channel: 'SALES_DOCUMENT',
          aggregateStatus: 'SUCCESS',
          complianceStatus: 'ACCEPTED',
          complianceDocumentId: documentId,
          oscuPhase: 'FINAL',
          eventId: randomUUID(),
          raw: { documentType: docType },
        });
      }
    }

    const data = await this.salesService.getNormalizedSaleReport(documentId);
    return { data };
  }

  /**
   * KRA ties tax treatment to the item's *own* current registration with
   * `saveItem`, not to the transaction -- see `findItemsNotRegisteredExempt`'s
   * doc comment for the full evidence trail (this went through a wrong
   * "correct" to classification-level before landing here, confirmed by two
   * items sharing one classification but registered under different codes
   * behaving oppositely). Refused up front, before a document is even
   * created, rather than submitted and left to KRA to bounce (which would
   * also burn a reserved `invcNo` for nothing). Only used for a fresh sale:
   * an express credit note reuses its original's already-ACCEPTED lines,
   * which passed this same check when the sale itself was created.
   */
  private async assertItemsAreExemptEligible(itemIds: string[]): Promise<void> {
    const items = await Promise.all(
      itemIds.map((id) => this.catalog.getItemById(id)),
    );
    const resolved = items
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .map((item) => ({ id: item.id, name: item.name, taxTyCd: item.taxTyCd }));

    const notExempt = findItemsNotRegisteredExempt(resolved);
    if (notExempt.length > 0) {
      throw new BadRequestException({
        message: `Cannot file this sale as tax-exempt: ${notExempt
          .map((i) => i.name)
          .join(', ')} ${notExempt.length === 1 ? 'is' : 'are'} registered with KRA at a taxed rate, not Exempt. Re-classify and re-sync the item to KRA (Item Sync) before selling it this way.`,
        items: notExempt.map((i) => i.id),
      });
    }
  }

  @Post('resync-invoice-sequence')
  @ApiOperation({
    summary:
      'Recover the true invcNo sequence for this tin directly from KRA (/selectSalesTransactions) instead of guessing',
  })
  @ApiResponse({ status: 201, description: 'Sequence resynced' })
  async resyncInvoiceSequence(@Body() body: ResyncOscuSequenceDto) {
    return this.salesService.resyncInvoiceSequenceFromKra(body);
  }

  @Post('credit-notes/express')
  @ApiOperation({
    summary: 'Create an express credit note from an existing sale',
  })
  @ApiResponse({
    status: 201,
    description: 'Credit note created',
    type: SalesReportDetailResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  async createExpressCreditNote(
    @Body() body: CreateExpressCreditNoteDto,
    @Req() req: Request,
    @Query('submit') submit?: string,
  ): Promise<SalesReportDetailResponseDto> {
    const shouldSubmit = submit === undefined ? true : submit !== 'false';

    const original = (await this.salesService.getDocument(body.saleId))
      .document;
    if (original.merchantId !== body.merchantId) {
      throw new BadRequestException({
        message: 'saleId does not belong to merchantId',
      });
    }
    if (original.branchId !== body.branchId) {
      throw new BadRequestException({
        message: 'saleId does not belong to branchId',
      });
    }
    if (original.complianceStatus !== ComplianceStatus.ACCEPTED) {
      throw new BadRequestException({
        message: 'Sale must be ACCEPTED to create an express credit note',
        status: original.complianceStatus,
      });
    }

    const items = original.lines.map((l) => ({
      itemId: l.itemId,
      description: l.description,
      quantity: Math.abs(l.quantity),
      unitPrice: l.unitPrice,
      taxCategory: l.taxCategory,
      taxAmount: Math.abs(l.taxAmount),
      discountRate: l.discountRate,
      discountAmount: l.discountAmount,
      // Carries the original's actual submitted tax code forward (e.g. 'A'
      // on a line from an EXEMPT sale) -- without it, this would silently
      // re-derive from the catalog item's current taxTyCd, which can differ
      // from what the original sale actually charged (see
      // applyInvoiceTypeOverride's doc comment for why taxCategory alone is
      // not what reaches KRA).
      taxTyCdSnapshot: l.taxTyCdSnapshot ?? undefined,
    }));

    const createResult = await this.salesService.createDocument(
      {
        merchantId: body.merchantId,
        branchId: body.branchId,
        sourceSystem: SourceSystem.API,
        sourceDocumentId: body.traderInvoiceNumber,
        documentType: DocumentType.CREDIT_NOTE,
        documentNumber: body.traderInvoiceNumber,
        originalDocumentNumber: original.documentNumber,
        originalSaleId: body.saleId,
        saleDate: body.returnDate,
        // OSCU rfdDt (credit note date) is required -- KRA rejects a null value
        // with "Missing RfdDt Date" (confirmed live 2026-08-11). Express credit
        // notes don't take a separate date field, so derive it from returnDate.
        creditNoteDate: body.returnDate,
        // OSCU rfdRsnCd is required too -- KRA rejects a missing value with
        // "Invalid RfdRsnCd" (confirmed live 2026-08-11). Default to 06 (Refund).
        creditNoteReasonCode: body.creditNoteReasonCode ?? '06',
        receiptTypeCode: 'R',
        paymentTypeCode:
          body.paymentTypeCode ?? original.paymentTypeCode ?? '01',
        invoiceStatusCode:
          body.invoiceStatusCode ?? original.invoiceStatusCode ?? '02',
        // Not read from the request -- a credit note reverses the sale it
        // references, so it carries that sale's own tax treatment rather than
        // letting a caller choose independently. `items` above already copied
        // the original's per-line taxCategory/taxAmount, so this is just the
        // matching document-level record for reporting.
        invoiceType: original.invoiceType,
        currency: original.currency,
        exchangeRate: original.exchangeRate,
        subtotalAmount: items.reduce(
          (sum, i) =>
            sum + resolveLineDiscount(i.quantity, i.unitPrice, i.discountRate, i.discountAmount).net,
          0,
        ),
        totalTax: items.reduce((sum, i) => sum + i.taxAmount, 0),
        totalAmount: items.reduce(
          (sum, i) =>
            sum + resolveLineDiscount(i.quantity, i.unitPrice, i.discountRate, i.discountAmount).net + i.taxAmount,
          0,
        ),
        customerPin: original.customerPin,
        lines: items,
      },
      { enqueueProcessing: false },
    );

    const documentId = createResult.document.id;

    if (createResult.created && shouldSubmit) {
      const validation = await this.salesService.validateDocument(documentId);
      if (!validation.validation.isValid) {
        throw new BadRequestException({
          message: 'Credit note validation failed',
          errors: validation.validation.errors,
        });
      }

      try {
        await this.salesService.prepareDocument(documentId);
        await this.salesService.submitDocument(documentId);
      } catch (error) {
        if (error instanceof ItemNotReadyForEtimsError) {
          throw new BadRequestException(
            `Cannot submit this credit note: ${error.message} -- sync this item to KRA (Item Sync) before selling it.`,
          );
        }
        throw error;
      }

      const corr = parseSync2BooksCorrelation(req);
      if (corr) {
        await this.correlationPersistence.patchComplianceDocument(
          documentId,
          corr,
        );
        await this.oscuCallback.postOutcomeWithCorrelation(corr, {
          channel: 'SALES_DOCUMENT',
          aggregateStatus: 'SUCCESS',
          complianceStatus: 'ACCEPTED',
          complianceDocumentId: documentId,
          oscuPhase: 'FINAL',
          eventId: randomUUID(),
          raw: {
            documentType: DocumentType.CREDIT_NOTE,
            expressCreditNote: true,
            originalSaleId: body.saleId,
          },
        });
      }
    }

    const data = await this.salesService.getNormalizedSaleReport(documentId);
    return { data };
  }

  // @Get(':id')
  // @ApiOperation({ summary: 'Get sale status/details' })
  // @ApiResponse({
  //   status: 200,
  //   description: 'Sale details',
  //   type: GetSaleResponseDto,
  // })
  // async getSale(@Param('id') id: string): Promise<GetSaleResponseDto> {
  //   const result = await this.salesService.getDocument(id);
  //   const kraResponse = toKraSalesSaveResponseDto(
  //     await this.salesService.getKraSalesSaveResponse(id),
  //   );
  //   return { document: this.toSaleDocumentDto(result.document), kraResponse };
  // }

  @Get(':id')
  @ApiOperation({ summary: 'Get sale by sale id' })
  @ApiResponse({
    status: 200,
    description: 'Sale report detail',
    type: SalesReportDetailResponseDto,
  })
  async getSaleReport(
    @Param('id') id: string,
  ): Promise<SalesReportDetailResponseDto> {
    const data = await this.salesService.getNormalizedSaleReport(id);
    return { data };
  }

  @Get(':id/receipt')
  @ApiOperation({
    summary:
      'Download the KRA eTIMS receipt PDF for an ACCEPTED sale. Pass copy=true for a reprint: marked COPY (heading + watermark) per TIS §11.',
  })
  @ApiResponse({ status: 200, description: 'Receipt PDF' })
  async getReceipt(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
    @Query('copy') copy?: string,
  ): Promise<StreamableFile> {
    const isCopy = copy === 'true';
    const pdf = await this.salesService.getEtimsReceiptPdf(id, {
      copy: isCopy,
    });
    if (!pdf) {
      throw new NotFoundException(
        'Receipt not available -- sale has not been accepted by KRA yet',
      );
    }
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="etims-receipt-${isCopy ? 'copy-' : ''}${id}.pdf"`,
    });
    return new StreamableFile(pdf);
  }

  // private toSaleDocumentDto(
  //   document: ComplianceDocument,
  // ): SaleDocumentResponseDto {
  //   return {
  //     id: document.id,
  //     merchantId: document.merchantId,
  //     branchId: document.branchId,
  //     sourceSystem: document.sourceSystem,
  //     sourceDocumentId: document.sourceDocumentId,
  //     documentType: document.documentType,
  //     documentNumber: document.documentNumber,
  //     saleDate: document.saleDate,
  //     receiptTypeCode: document.receiptTypeCode,
  //     paymentTypeCode: document.paymentTypeCode,
  //     invoiceStatusCode: document.invoiceStatusCode,
  //     currency: document.currency,
  //     exchangeRate: document.exchangeRate,
  //     subtotalAmount: document.subtotalAmount,
  //     totalAmount: document.totalAmount,
  //     totalTax: document.totalTax,
  //     customerPin: document.customerPin,
  //     complianceStatus: document.complianceStatus,
  //     submissionAttempts: document.submissionAttempts,
  //     etimsReceiptNumber: document.etimsReceiptNumber,
  //     idempotencyKey: document.idempotencyKey,
  //     createdAt: document.createdAt,
  //     submittedAt: document.submittedAt,
  //     lines: document.lines.map((l) => ({
  //       id: l.id,
  //       itemId: l.itemId,
  //       description: l.description,
  //       quantity: l.quantity,
  //       unitPrice: l.unitPrice,
  //       taxCategory: l.taxCategory,
  //       taxAmount: l.taxAmount,
  //       classificationCodeSnapshot: l.classificationCodeSnapshot,
  //       unitCodeSnapshot: l.unitCodeSnapshot,
  //       packagingUnitCodeSnapshot: l.packagingUnitCodeSnapshot,
  //       taxTyCdSnapshot: l.taxTyCdSnapshot,
  //       productTypeCodeSnapshot: l.productTypeCodeSnapshot,
  //       createdAt: l.createdAt,
  //     })),
  //   };
  // }

  // KRA response mapping lives in `kra-sales-save-response.mapper.ts`
}

function asNullableString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return v === '' ? null : v;
}
