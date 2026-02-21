import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
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
import { ComplianceStatus } from '../../shared/domain/enums/compliance-status.enum';

@Controller('dashboard-api/sales')
@ApiTags('Dashboard Sales')
export class DashboardSalesController {
  constructor(private readonly salesService: SalesService) {}

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

    // Dashboard can still be synchronous for MVP; later make async + polling.
    if (createResult.created && shouldSubmit) {
      const validation = await this.salesService.validateDocument(documentId);
      if (!validation.validation.isValid) {
        throw new BadRequestException({
          message: 'Sale validation failed',
          errors: validation.validation.errors,
        });
      }

      await this.salesService.prepareDocument(documentId);
      await this.salesService.submitDocument(documentId);
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
