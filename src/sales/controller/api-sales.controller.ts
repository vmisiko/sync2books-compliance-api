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
import { SourceSystem } from '../../shared/domain/enums/source-system.enum';
import {
  SalesReportDetailResponseDto,
  SalesReportListResponseDto,
} from './dto/sales-report.dto';
import { CreateExpressCreditNoteDto } from './dto/create-express-credit-note.dto';
import { ResyncOscuSequenceDto } from './dto/resync-oscu-sequence.dto';
import { ComplianceStatus } from '../../shared/domain/enums/compliance-status.enum';
import { ComplianceServiceAuthGuard } from '../../integration/compliance-service-auth.guard';
import { PlatformOscuCallbackService } from '../../integration/platform-outbound/platform-oscu-callback.service';
import { Sync2BooksCorrelationPersistenceService } from '../../integration/platform-outbound/sync2books-correlation-persistence.service';
import { parseSync2BooksCorrelation } from '../../integration/platform-outbound/sync2books-request-headers.util';

@Controller('api/sales')
@ApiTags('API Sales')
@UseGuards(ComplianceServiceAuthGuard)
export class ApiSalesController {
  constructor(
    private readonly salesService: SalesService,
    private readonly oscuCallback: PlatformOscuCallbackService,
    private readonly correlationPersistence: Sync2BooksCorrelationPersistenceService,
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

    const normalizeForCreditNote = docType === DocumentType.CREDIT_NOTE;
    const items = normalizeForCreditNote
      ? body.items.map((i) => ({
          ...i,
          quantity: Math.abs(i.quantity),
          taxAmount: Math.abs(i.taxAmount),
        }))
      : body.items;

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
        currency: 'KES',
        exchangeRate: 1,
        subtotalAmount: items.reduce(
          (sum, i) => sum + i.quantity * i.unitPrice,
          0,
        ),
        totalTax: items.reduce((sum, i) => sum + i.taxAmount, 0),
        totalAmount: items.reduce(
          (sum, i) => sum + i.quantity * i.unitPrice + i.taxAmount,
          0,
        ),
        customerPin: body.customerTin ?? null,
        lines: items.map((i) => ({
          itemId: i.id,
          description: i.itemDescription ?? '',
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          taxCategory: i.taxCategory,
          taxAmount: i.taxAmount,
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
        currency: original.currency,
        exchangeRate: original.exchangeRate,
        subtotalAmount: items.reduce(
          (sum, i) => sum + i.quantity * i.unitPrice,
          0,
        ),
        totalTax: items.reduce((sum, i) => sum + i.taxAmount, 0),
        totalAmount: items.reduce(
          (sum, i) => sum + i.quantity * i.unitPrice + i.taxAmount,
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

      await this.salesService.prepareDocument(documentId);
      await this.salesService.submitDocument(documentId);

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
    summary: 'Download the KRA eTIMS receipt PDF for an ACCEPTED sale',
  })
  @ApiResponse({ status: 200, description: 'Receipt PDF' })
  async getReceipt(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const pdf = await this.salesService.getEtimsReceiptPdf(id);
    if (!pdf) {
      throw new NotFoundException(
        'Receipt not available -- sale has not been accepted by KRA yet',
      );
    }
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="etims-receipt-${id}.pdf"`,
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
