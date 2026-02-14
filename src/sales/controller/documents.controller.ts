import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { DocumentType } from '../../shared/domain/enums/document-type.enum';
import { SourceSystem } from '../../shared/domain/enums/source-system.enum';
import { SalesService } from '../application/sales.service';

/**
 * OpenAPI-aligned document endpoints.
 *
 * - POST /documents
 * - GET /documents/:id
 * - GET /documents/merchants/:merchantId
 * - POST /documents/:id/validate
 * - POST /documents/:id/prepare
 * - POST /documents/:id/submit
 */
@Controller('documents')
export class DocumentsController {
  constructor(private readonly salesService: SalesService) {}

  @Post()
  async createDocument(
    @Body()
    body: {
      merchantId: string;
      branchId: string;
      sourceSystem: SourceSystem;
      sourceDocumentId: string;
      documentType: DocumentType;
      documentNumber: string;
      currency: string;
      exchangeRate: number;
      subtotalAmount: number;
      totalTax: number;
      totalAmount: number;
      customerPin?: string | null;
      lines: Array<{
        itemId: string;
        description: string;
        quantity: number;
        unitPrice: number;
        taxCategory: string;
        taxAmount: number;
        classificationCodeSnapshot: string;
        unitCodeSnapshot: string;
      }>;
    },
  ) {
    return this.salesService.createDocument(body);
  }

  @Get(':id')
  async getDocument(@Param('id') id: string) {
    return this.salesService.getDocument(id);
  }

  @Get('merchants/:merchantId')
  async listDocuments(@Param('merchantId') merchantId: string) {
    return this.salesService.listDocuments(merchantId);
  }

  @Post(':id/validate')
  async validateDocument(@Param('id') id: string) {
    return this.salesService.validateDocument(id);
  }

  @Post(':id/prepare')
  async prepareDocument(@Param('id') id: string) {
    return this.salesService.prepareDocument(id);
  }

  @Post(':id/submit')
  async submitDocument(@Param('id') id: string) {
    return this.salesService.submitDocument(id);
  }
}
