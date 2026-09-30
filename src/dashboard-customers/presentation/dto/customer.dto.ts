import { ApiProperty } from '@nestjs/swagger';

export class CreateCustomerDto {
  @ApiProperty()
  merchantId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ required: false, description: 'KRA PIN' })
  tin?: string;

  @ApiProperty({ required: false })
  phoneNumber?: string;

  @ApiProperty({ required: false })
  email?: string;

  @ApiProperty({
    required: false,
    default: false,
    description:
      'Whether this customer holds a KRA tax exemption -- defaults the "Invoice Type" on Add Sale to EXEMPT for them.',
  })
  taxExempt?: boolean;

  @ApiProperty({
    required: false,
    default: false,
    description:
      'Also create (or link) this customer in the connected ERP right away. The response then carries an `erp` outcome.',
  })
  syncToErp?: boolean;
}

export class UpdateCustomerDto {
  @ApiProperty({ required: false })
  name?: string;

  @ApiProperty({ required: false, description: 'KRA PIN' })
  tin?: string;

  @ApiProperty({ required: false })
  phoneNumber?: string;

  @ApiProperty({ required: false })
  email?: string;

  @ApiProperty({ required: false })
  taxExempt?: boolean;
}

export class CustomerResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  merchantId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true })
  tin!: string | null;

  @ApiProperty({ nullable: true })
  phoneNumber!: string | null;

  @ApiProperty({ nullable: true })
  email!: string | null;

  @ApiProperty({ nullable: true, description: 'ERP provenance (SourceSystem enum value), when pulled from an ERP' })
  sourceSystem!: string | null;

  @ApiProperty({ description: 'Whether this customer holds a KRA tax exemption' })
  taxExempt!: boolean;

  @ApiProperty()
  createdAt!: Date;
}

export class VerifyKraResponseDto {
  @ApiProperty({ description: 'Whether a matching taxpayer record was found' })
  found!: boolean;

  @ApiProperty({ nullable: true })
  taxpayerName!: string | null;

  @ApiProperty({
    description:
      'Raw OSCU selectTaxpayerInfo response, for callers that need fields not surfaced above',
  })
  raw!: unknown;
}

export class CustomerIdsDto {
  @ApiProperty({ type: [String] })
  ids!: string[];
}
