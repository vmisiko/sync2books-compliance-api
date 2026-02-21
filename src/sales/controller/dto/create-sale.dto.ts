import { ApiProperty } from '@nestjs/swagger';

export class CreateSaleItemDto {
  @ApiProperty({ description: 'Catalog item id (stable)' })
  id!: string;

  @ApiProperty()
  quantity!: number;

  @ApiProperty()
  unitPrice!: number;

  @ApiProperty({
    description:
      'Internal tax category string (e.g. VAT_STANDARD). Required for MVP until tax engine is added.',
  })
  taxCategory!: string;

  @ApiProperty({
    description:
      'Tax amount for this line. Required for MVP until tax engine is added.',
  })
  taxAmount!: number;

  @ApiProperty({ required: false })
  discountRate?: number;

  @ApiProperty({ required: false })
  discountAmount?: number;

  @ApiProperty({ required: false })
  itemDescription?: string;
}

export class CreateSaleDto {
  @ApiProperty()
  merchantId!: string;

  @ApiProperty()
  branchId!: string;

  @ApiProperty({ description: 'YYYY-MM-DD' })
  saleDate!: string;

  @ApiProperty()
  traderInvoiceNumber!: string;

  @ApiProperty({
    required: false,
    description:
      'For credit notes (receiptTypeCode=R): original sale trader invoice number',
  })
  originalTraderInvoiceNumber?: string;

  @ApiProperty({ required: false })
  customerTin?: string;

  @ApiProperty({ required: false })
  customerName?: string;

  @ApiProperty({ description: 'Receipt type code, e.g. S or R' })
  receiptTypeCode!: string;

  @ApiProperty({ description: 'Payment type code, e.g. 01..08' })
  paymentTypeCode!: string;

  @ApiProperty({ description: 'Invoice status code (OSCU salesSttsCd)' })
  invoiceStatusCode!: string;

  @ApiProperty({ type: [CreateSaleItemDto] })
  items!: CreateSaleItemDto[];
}
