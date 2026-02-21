import { ApiProperty } from '@nestjs/swagger';

export class CursorPaginationDto {
  @ApiProperty({ nullable: true })
  next!: string | null;

  @ApiProperty({ nullable: true })
  previous!: string | null;

  @ApiProperty()
  pageSize!: number;
}

export class SalesTaxSummaryDto {
  @ApiProperty()
  taxableAmountA!: number;
  @ApiProperty()
  taxableAmountB!: number;
  @ApiProperty()
  taxableAmountC!: number;
  @ApiProperty()
  taxableAmountD!: number;
  @ApiProperty()
  taxableAmountE!: number;

  @ApiProperty()
  taxRateA!: number;
  @ApiProperty()
  taxRateB!: number;
  @ApiProperty()
  taxRateC!: number;
  @ApiProperty()
  taxRateD!: number;
  @ApiProperty()
  taxRateE!: number;

  @ApiProperty()
  taxAmountA!: number;
  @ApiProperty()
  taxAmountB!: number;
  @ApiProperty()
  taxAmountC!: number;
  @ApiProperty()
  taxAmountD!: number;
  @ApiProperty()
  taxAmountE!: number;

  @ApiProperty()
  cateringLevyRate!: number;
  @ApiProperty()
  serviceChargeRate!: number;
  @ApiProperty()
  cateringLevyAmount!: number;
  @ApiProperty()
  serviceChargeAmount!: number;
}

export class SaleItemReportDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  quantity!: number;

  @ApiProperty()
  unitPrice!: number;

  @ApiProperty()
  totalAmount!: number;

  @ApiProperty()
  taxableAmount!: number;

  @ApiProperty()
  taxAmount!: number;

  @ApiProperty()
  taxRate!: number;

  @ApiProperty({ nullable: true })
  taxTypeCode!: string | null;

  @ApiProperty()
  discountRate!: number;

  @ApiProperty()
  discountAmount!: number;

  @ApiProperty({ nullable: true })
  etimsItemCode!: string | null;

  @ApiProperty({ nullable: true })
  isStockable!: boolean | null;

  @ApiProperty()
  itemId!: string;
}

export class SaleReportDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: 'DD/MM/YYYY', nullable: true })
  date!: string | null;

  @ApiProperty({ description: 'hh:mm:ss am/pm', nullable: true })
  time!: string | null;

  @ApiProperty()
  traderInvoiceNumber!: string;

  @ApiProperty({ nullable: true })
  receiptTypeCode!: string | null;

  @ApiProperty({ nullable: true })
  saleDetailUrl!: string | null;

  @ApiProperty({ nullable: true })
  serialNumber!: string | null;

  @ApiProperty({ nullable: true })
  receiptNumber!: number | null;

  @ApiProperty({ nullable: true })
  invoiceNumber!: number | null;

  @ApiProperty({ nullable: true })
  customerId!: string | null;

  @ApiProperty({ nullable: true })
  customerName!: string | null;

  @ApiProperty({ nullable: true })
  customerTin!: string | null;

  @ApiProperty({ nullable: true })
  customerPhoneNumber!: string | null;

  @ApiProperty({ nullable: true })
  customerEmail!: string | null;

  @ApiProperty({ nullable: true })
  internalData!: string | null;

  @ApiProperty({ nullable: true })
  receiptSignature!: string | null;

  @ApiProperty({ nullable: true })
  etimsUrl!: string | null;

  @ApiProperty({ nullable: true })
  originalSaleId!: string | null;

  @ApiProperty({ nullable: true })
  offlineUrl!: string | null;

  @ApiProperty({
    description:
      'Digitax-like status: completed|pending|failed|retrying|cancelled',
  })
  status!: string;

  @ApiProperty({ type: SalesTaxSummaryDto })
  salesTaxSummary!: SalesTaxSummaryDto;

  @ApiProperty({ type: [SaleItemReportDto] })
  itemList!: SaleItemReportDto[];
}

export class SalesReportListResponseDto {
  @ApiProperty({ type: CursorPaginationDto })
  pagination!: CursorPaginationDto;

  @ApiProperty({ type: [SaleReportDto] })
  data!: SaleReportDto[];
}

export class SalesReportDetailResponseDto {
  @ApiProperty({ type: SaleReportDto })
  data!: SaleReportDto;
}

export {};
