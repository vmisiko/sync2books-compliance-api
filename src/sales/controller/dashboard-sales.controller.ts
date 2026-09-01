import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
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
import { RetrySalesDto } from './dto/retry-sales.dto';
import { ComplianceStatus } from '../../shared/domain/enums/compliance-status.enum';
import { DashboardJwtAuthGuard } from '../../dashboard-identity/infrastructure/guards/dashboard-jwt-auth.guard';
import { MailerService } from '../../mailer/mailer.service';
import { EmailReceiptDto } from './dto/email-receipt.dto';
import { renderReceiptEmailHtml } from '../application/receipt/receipt-email.renderer';
import { ItemNotReadyForEtimsError } from '../domain/errors/item-not-ready-for-etims.error';

/**
 * Guarded (previously open to any caller). Still trusts merchantId/branchId
 * from the request body/query rather than deriving them from the verified
 * token — that's a separate, larger fix (see the "Guard DashboardSalesController
 * with Mode B auth" follow-up) since it touches this controller's contract.
 */
@Controller('dashboard-api/sales')
@ApiTags('Dashboard Sales')
@UseGuards(DashboardJwtAuthGuard)
@ApiBearerAuth()
export class DashboardSalesController {
  constructor(
    private readonly salesService: SalesService,
    private readonly mailer: MailerService,
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
    // Back-compat
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
  @ApiOperation({ summary: 'Create a sale (dashboard)' })
  @ApiResponse({
    status: 201,
    description: 'Sale created',
    type: SalesReportDetailResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  async createSale(
    @Body() body: CreateSaleDto,
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
        })),
      },
      { enqueueProcessing: false },
    );

    const documentId = createResult.document.id;

    // Dashboard can still be synchronous for MVP; later make async + polling.
    if (createResult.created && shouldSubmit) {
      await this.salesService.submitDraftDocument(documentId);
    }

    const data = await this.salesService.getNormalizedSaleReport(documentId);
    return { data };
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
        // with "Missing RfdDt Date". Express credit notes don't take a separate
        // date field, so derive it from returnDate (same fix as api-sales.controller.ts).
        creditNoteDate: body.returnDate,
        // OSCU rfdRsnCd is required too -- KRA rejects a missing value with
        // "Invalid RfdRsnCd". Default to 06 (Refund).
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
    }

    const data = await this.salesService.getNormalizedSaleReport(documentId);
    return { data };
  }

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Retry submission to KRA eTIMS for selected (or all Pending/Failed) sales/credit notes',
  })
  @ApiResponse({ status: 200, description: 'Retry result' })
  async sync(@Body() body: RetrySalesDto) {
    const result = await this.salesService.retrySales({
      merchantId: body.merchantId,
      documentIds: body.documentIds?.length ? body.documentIds : undefined,
    });
    return { success: true, message: 'Sales retried', data: result };
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

  @Get(':id/')
  @ApiOperation({ summary: 'Get sale  by sale id' })
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

  @Post(':id/email')
  @ApiOperation({
    summary:
      "Email the sale invoice receipt to the customer (attaches the KRA receipt PDF when the sale has been ACCEPTED, otherwise sends the summary only)",
  })
  @ApiResponse({ status: 200, description: 'Email result' })
  @ApiBadRequestResponse({ description: 'No destination email available' })
  async emailReceipt(@Param('id') id: string, @Body() body: EmailReceiptDto) {
    const report = await this.salesService.getNormalizedSaleReport(id);
    const to = body.email ?? report.customerEmail;
    if (!to) {
      throw new BadRequestException(
        'No email address on file for this sale -- pass one explicitly',
      );
    }

    const pdf = await this.salesService.getEtimsReceiptPdf(id);
    const result = await this.mailer.send({
      to,
      subject: `Sale Invoice ${report.traderInvoiceNumber}`,
      html: renderReceiptEmailHtml(report),
      attachments: pdf
        ? [
            {
              filename: `etims-receipt-${id}.pdf`,
              content: pdf,
              contentType: 'application/pdf',
            },
          ]
        : undefined,
    });

    return { success: result.sent, to, ...result };
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
