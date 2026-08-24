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
