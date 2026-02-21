import { ApiProperty } from '@nestjs/swagger';
import { ComplianceStatus } from '../../../shared/domain/enums/compliance-status.enum';
import { DocumentType } from '../../../shared/domain/enums/document-type.enum';
import { SourceSystem } from '../../../shared/domain/enums/source-system.enum';
import { TaxCategory } from '../../../shared/domain/enums/tax-category.enum';

export class KraSalesSaveResponseDataDto {
  @ApiProperty()
  curRcptNo!: string;

  @ApiProperty()
  totRcptNo!: string;

  @ApiProperty()
  intrlData!: string;

  @ApiProperty()
  rcptSign!: string;

  @ApiProperty()
  sdcDateTime!: string;
}

/**
 * Exact KRA (OSCU) response payload for `/saveTrnsSalesOsdc`.
 * Source: OSCU spec TrnsSalesSaveWrRes JSON sample.
 */
export class KraSalesSaveResponseDto {
  @ApiProperty()
  resultCd!: string;

  @ApiProperty()
  resultMsg!: string;

  @ApiProperty()
  resultDt!: string;

  @ApiProperty({ type: KraSalesSaveResponseDataDto, nullable: true })
  data!: KraSalesSaveResponseDataDto | null;
}

export class SaleCreateResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ComplianceStatus })
  status!: ComplianceStatus;

  @ApiProperty({ nullable: true })
  receiptNumber!: string | null;

  @ApiProperty({ type: KraSalesSaveResponseDto, nullable: true })
  kraResponse!: KraSalesSaveResponseDto | null;
}

export class SaleLineResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  itemId!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty()
  quantity!: number;

  @ApiProperty()
  unitPrice!: number;

  @ApiProperty({ enum: TaxCategory })
  taxCategory!: TaxCategory;

  @ApiProperty()
  taxAmount!: number;

  @ApiProperty()
  classificationCodeSnapshot!: string;

  @ApiProperty()
  unitCodeSnapshot!: string;

  @ApiProperty({ nullable: true })
  packagingUnitCodeSnapshot!: string | null;

  @ApiProperty({ nullable: true })
  taxTyCdSnapshot!: string | null;

  @ApiProperty({ nullable: true })
  productTypeCodeSnapshot!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

export class SaleDocumentResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  merchantId!: string;

  @ApiProperty()
  branchId!: string;

  @ApiProperty({ enum: SourceSystem })
  sourceSystem!: SourceSystem;

  @ApiProperty()
  sourceDocumentId!: string;

  @ApiProperty({ enum: DocumentType })
  documentType!: DocumentType;

  @ApiProperty()
  documentNumber!: string;

  @ApiProperty({ nullable: true, description: 'YYYY-MM-DD' })
  saleDate!: string | null;

  @ApiProperty({ nullable: true })
  receiptTypeCode!: string | null;

  @ApiProperty({ nullable: true })
  paymentTypeCode!: string | null;

  @ApiProperty({ nullable: true })
  invoiceStatusCode!: string | null;

  @ApiProperty()
  currency!: string;

  @ApiProperty()
  exchangeRate!: number;

  @ApiProperty()
  subtotalAmount!: number;

  @ApiProperty()
  totalAmount!: number;

  @ApiProperty()
  totalTax!: number;

  @ApiProperty({ nullable: true })
  customerPin!: string | null;

  @ApiProperty({ enum: ComplianceStatus })
  complianceStatus!: ComplianceStatus;

  @ApiProperty()
  submissionAttempts!: number;

  @ApiProperty({ nullable: true })
  etimsReceiptNumber!: string | null;

  @ApiProperty()
  idempotencyKey!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  submittedAt!: Date | null;

  @ApiProperty({ type: [SaleLineResponseDto] })
  lines!: SaleLineResponseDto[];
}

export class GetSaleResponseDto {
  @ApiProperty({ type: SaleDocumentResponseDto })
  document!: SaleDocumentResponseDto;

  @ApiProperty({ type: KraSalesSaveResponseDto, nullable: true })
  kraResponse!: KraSalesSaveResponseDto | null;
}
