import { ApiProperty } from '@nestjs/swagger';
import { DocumentType } from '../../../shared/domain/enums/document-type.enum';
import { SourceSystem } from '../../../shared/domain/enums/source-system.enum';

export class CreateDocumentLineDto {
  @ApiProperty()
  itemId!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty()
  quantity!: number;

  @ApiProperty()
  unitPrice!: number;

  @ApiProperty({
    description:
      'Internal tax category (mapped to OSCU tax type internally). e.g. VAT_STANDARD',
  })
  taxCategory!: string;

  @ApiProperty()
  taxAmount!: number;
}

export class CreateDocumentDto {
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

  @ApiProperty()
  currency!: string;

  @ApiProperty()
  exchangeRate!: number;

  @ApiProperty()
  subtotalAmount!: number;

  @ApiProperty()
  totalTax!: number;

  @ApiProperty()
  totalAmount!: number;

  @ApiProperty({ required: false, nullable: true })
  customerPin?: string | null;

  @ApiProperty({ type: [CreateDocumentLineDto] })
  lines!: CreateDocumentLineDto[];
}
