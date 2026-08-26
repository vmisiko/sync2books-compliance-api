import { ApiProperty } from '@nestjs/swagger';

export class CreateSupplierDto {
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
    description:
      'ERP provenance override for suppliers created from a non-ERP source (e.g. "ETIMS" for a supplier created from an unmatched KRA purchase). Omit for the normal manually-added-by-a-human path, which leaves this null.',
  })
  sourceSystem?: string;
}

export class UpdateSupplierDto {
  @ApiProperty({ required: false })
  name?: string;

  @ApiProperty({ required: false, description: 'KRA PIN' })
  tin?: string;

  @ApiProperty({ required: false })
  phoneNumber?: string;

  @ApiProperty({ required: false })
  email?: string;
}

export class SupplierResponseDto {
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

  @ApiProperty({
    nullable: true,
    description:
      'ERP provenance (SourceSystem enum value), when pulled from an ERP',
  })
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
