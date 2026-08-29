import { ApiProperty } from '@nestjs/swagger';

export class UpdateReceiptSettingsDto {
  @ApiProperty({
    description:
      'Whether a successful eTIMS submission from a pulled invoice should automatically ' +
      'push the receipt back to Main API (POST /internal/compliance/invoice-receipt). ' +
      "When false, use POST /dashboard-api/invoices/:id/upload-receipt to push it on demand.",
    example: true,
  })
  autoUploadReceiptToSource!: boolean;
}

export class RecordIntegrationConnectionDto {
  @ApiProperty({
    description: 'Which accounting tool was connected',
    example: 'quickbooks',
  })
  integrationKey!: string;

  @ApiProperty({
    description: 'Main-API connectionId returned by the Sync2BooksLink widget',
  })
  connectionId!: string;
}
