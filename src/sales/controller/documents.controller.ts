import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SalesService } from '../application/sales.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import {
  GetSaleResponseDto,
  SaleDocumentResponseDto,
} from './dto/sale-response.dto';
import type { ComplianceDocument } from '../domain/entities/compliance-document.entity';
import { toKraSalesSaveResponseDto } from './kra-sales-save-response.mapper';

/**
 * Internal document engine endpoints.
 *
 * These remain available for debugging / internal use.
 * Public-facing endpoints should prefer `POST /api/sales`.
 */
@Controller('documents')
@ApiTags('Documents')
export class DocumentsController {
  constructor(private readonly salesService: SalesService) {}

  @Post()
  @ApiOperation({ summary: 'Create compliance document (DRAFT)' })
  @ApiResponse({ status: 201, description: 'Document created' })
  async createDocument(@Body() body: CreateDocumentDto) {
    return this.salesService.createDocument(body);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get document details' })
  @ApiResponse({
    status: 200,
    description: 'Document details',
    type: GetSaleResponseDto,
  })
  async getDocument(@Param('id') id: string): Promise<GetSaleResponseDto> {
    const result = await this.salesService.getDocument(id);
    const kraResponse = toKraSalesSaveResponseDto(
      await this.salesService.getKraSalesSaveResponse(id),
    );
    return { document: this.toSaleDocumentDto(result.document), kraResponse };
  }

  @Get('merchants/:merchantId')
  @ApiOperation({ summary: 'List documents by merchant' })
  @ApiResponse({ status: 200, description: 'Document list' })
  async listDocuments(@Param('merchantId') merchantId: string) {
    return this.salesService.listDocuments(merchantId);
  }

  @Post(':id/validate')
  @ApiOperation({ summary: 'Validate document before submission' })
  @ApiResponse({ status: 200, description: 'Validation result' })
  async validateDocument(@Param('id') id: string) {
    return this.salesService.validateDocument(id);
  }

  @Post(':id/prepare')
  @ApiOperation({ summary: 'Prepare document for submission' })
  @ApiResponse({ status: 200, description: 'Prepared' })
  async prepareDocument(@Param('id') id: string) {
    return this.salesService.prepareDocument(id);
  }

  @Post(':id/submit')
  @ApiOperation({ summary: 'Submit document to eTIMS' })
  @ApiResponse({ status: 200, description: 'Submission result' })
  async submitDocument(@Param('id') id: string) {
    return this.salesService.submitDocument(id);
  }

  private toSaleDocumentDto(
    document: ComplianceDocument,
  ): SaleDocumentResponseDto {
    return {
      id: document.id,
      merchantId: document.merchantId,
      branchId: document.branchId,
      sourceSystem: document.sourceSystem,
      sourceDocumentId: document.sourceDocumentId,
      documentType: document.documentType,
      documentNumber: document.documentNumber,
      saleDate: document.saleDate,
      receiptTypeCode: document.receiptTypeCode,
      paymentTypeCode: document.paymentTypeCode,
      invoiceStatusCode: document.invoiceStatusCode,
      currency: document.currency,
      exchangeRate: document.exchangeRate,
      subtotalAmount: document.subtotalAmount,
      totalAmount: document.totalAmount,
      totalTax: document.totalTax,
      customerPin: document.customerPin,
      complianceStatus: document.complianceStatus,
      submissionAttempts: document.submissionAttempts,
      etimsReceiptNumber: document.etimsReceiptNumber,
      idempotencyKey: document.idempotencyKey,
      createdAt: document.createdAt,
      submittedAt: document.submittedAt,
      lines: document.lines.map((l) => ({
        id: l.id,
        itemId: l.itemId,
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        taxCategory: l.taxCategory,
        taxAmount: l.taxAmount,
        classificationCodeSnapshot: l.classificationCodeSnapshot,
        unitCodeSnapshot: l.unitCodeSnapshot,
        packagingUnitCodeSnapshot: l.packagingUnitCodeSnapshot,
        taxTyCdSnapshot: l.taxTyCdSnapshot,
        productTypeCodeSnapshot: l.productTypeCodeSnapshot,
        createdAt: l.createdAt,
      })),
    };
  }

  // KRA response mapping lives in `kra-sales-save-response.mapper.ts`
}
