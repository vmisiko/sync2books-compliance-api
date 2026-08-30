import { ApiProperty } from '@nestjs/swagger';
import { SourceSystem } from '../../../shared/domain/enums/source-system.enum';

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

  @ApiProperty({ nullable: true })
  itemName!: string | null;

  @ApiProperty({ nullable: true })
  itemDescription!: string | null;
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

  @ApiProperty({
    nullable: true,
    description:
      'Main API Invoice id this sale was created from, when pulled from an ERP invoice (see createSaleFromInvoice). Null for a manually-entered sale.',
  })
  sourceInvoiceId!: string | null;

  @ApiProperty({
    nullable: true,
    description:
      "The KRA/OSCU rejection reason from the latest REJECTED event, populated only on the single-sale detail fetch (GET /sales/:id) when status is failed -- always null on the list endpoint.",
  })
  syncErrorMessage!: string | null;

  @ApiProperty({ nullable: true })
  offlineUrl!: string | null;

  @ApiProperty({
    description:
      'Digitax-like status: completed|pending|failed|retrying|cancelled',
  })
  status!: string;

  @ApiProperty({ nullable: true, description: "Trader's own business name (compliance tenant display name)" })
  supplierName!: string | null;

  @ApiProperty({ nullable: true, description: "Trader's own KRA PIN" })
  supplierPin!: string | null;

  @ApiProperty({ enum: SourceSystem, description: 'ERP provenance of this document, e.g. QUICKBOOKS/ODOO/API/MANUAL' })
  sourceSystem!: SourceSystem;

  @ApiProperty({ nullable: true, description: 'OSCU pmtTyCd, e.g. "01"' })
  paymentTypeCode!: string | null;

  @ApiProperty({ nullable: true, description: 'Human-readable payment method, e.g. "Cash"' })
  paymentTypeDescription!: string | null;

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
