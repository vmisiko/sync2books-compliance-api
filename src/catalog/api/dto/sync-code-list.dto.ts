import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SyncCodeListDto {
  @ApiProperty({
    description:
      'Merchant with a provisioned eTIMS connection to use for the OSCU call. The fetched list is global reference data, not merchant-scoped.',
  })
  merchantId!: string;

  @ApiProperty()
  branchId!: string;

  @ApiPropertyOptional({
    description:
      'Ignore the stored watermark (lastReqDt) and re-pull the full reference list.',
  })
  full?: boolean;
}
