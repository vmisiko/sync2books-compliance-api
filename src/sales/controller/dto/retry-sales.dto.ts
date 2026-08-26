import { ApiProperty } from '@nestjs/swagger';

/** Body for POST dashboard-api/sales/sync. */
export class RetrySalesDto {
  @ApiProperty({ description: 'Merchant id to retry sales for' })
  merchantId!: string;

  @ApiProperty({
    type: [String],
    required: false,
    description:
      'Compliance document ids to retry. Omit (or send an empty array) to retry every document in a retryable status (Pending/Failed) for the merchant.',
  })
  documentIds?: string[];
}
