import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class OscuLookupQueryDto {
  @ApiProperty({
    description:
      'Merchant with a provisioned eTIMS connection to use for the OSCU call.',
  })
  merchantId!: string;

  @ApiProperty({
    description:
      'sync2books branch id (resolved to the KRA bhfId server-side).',
  })
  branchId!: string;

  @ApiPropertyOptional({
    description:
      'Watermark for incremental pulls (yyyyMMddHHmmss). Defaults to the OSCU spec sample epoch on first pull.',
  })
  lastReqDt?: string;
}

export class OscuInvoiceDetailQueryDto {
  @ApiProperty()
  merchantId!: string;

  @ApiProperty()
  branchId!: string;

  @ApiProperty({
    description: 'KRA invoice number (invcNo) to fetch details for.',
  })
  invcNo!: string;
}

export class OscuWriteBodyDto {
  @ApiProperty({
    description:
      'Merchant with a provisioned eTIMS connection to use for the OSCU call.',
  })
  merchantId!: string;

  @ApiProperty({
    description:
      'sync2books branch id (resolved to the KRA bhfId server-side).',
  })
  branchId!: string;
}
