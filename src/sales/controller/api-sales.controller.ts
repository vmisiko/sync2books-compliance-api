import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SalesService } from '../application/sales.service';
import { CreateSaleDto } from './dto/create-sale.dto';
import { DocumentType } from '../../shared/domain/enums/document-type.enum';
import { SourceSystem } from '../../shared/domain/enums/source-system.enum';

@Controller('api/sales')
@ApiTags('API Sales')
export class ApiSalesController {
  constructor(private readonly salesService: SalesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a sale (Digitax-like)' })
  @ApiResponse({ status: 201, description: 'Sale created' })
  async createSale(@Body() body: CreateSaleDto) {
    const docType =
      body.receiptTypeCode === 'R'
        ? DocumentType.CREDIT_NOTE
        : DocumentType.SALE;

    const createResult = await this.salesService.createDocument(
      {
        merchantId: body.merchantId,
        branchId: body.branchId,
        sourceSystem: SourceSystem.API,
        sourceDocumentId: body.traderInvoiceNumber,
        documentType: docType,
        documentNumber: body.traderInvoiceNumber,
        saleDate: body.saleDate,
        receiptTypeCode: body.receiptTypeCode,
        paymentTypeCode: body.paymentTypeCode,
        invoiceStatusCode: body.invoiceStatusCode,
        currency: 'KES',
        exchangeRate: 1,
        subtotalAmount: body.items.reduce(
          (sum, i) => sum + i.quantity * i.unitPrice,
          0,
        ),
        totalTax: body.items.reduce((sum, i) => sum + i.taxAmount, 0),
        totalAmount: body.items.reduce(
          (sum, i) => sum + i.quantity * i.unitPrice + i.taxAmount,
          0,
        ),
        customerPin: body.customerTin ?? null,
        lines: body.items.map((i) => ({
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

    if (!createResult.created) {
      return {
        id: createResult.document.id,
        status: createResult.document.complianceStatus,
        receiptNumber: createResult.document.etimsReceiptNumber ?? null,
      };
    }

    // MVP: run the pipeline synchronously for dev API ergonomics
    const validation = await this.salesService.validateDocument(
      createResult.document.id,
    );
    if (!validation.validation.isValid) {
      throw new BadRequestException({
        message: 'Sale validation failed',
        errors: validation.validation.errors,
      });
    }

    await this.salesService.prepareDocument(createResult.document.id);
    const submitResult = await this.salesService.submitDocument(
      createResult.document.id,
    );

    return {
      id: submitResult.document.id,
      status: submitResult.document.complianceStatus,
      receiptNumber: submitResult.receiptNumber ?? null,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get sale status/details' })
  @ApiResponse({ status: 200, description: 'Sale details' })
  async getSale(@Param('id') id: string) {
    return this.salesService.getDocument(id);
  }
}
