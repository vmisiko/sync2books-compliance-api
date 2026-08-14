import { ApiProperty } from '@nestjs/swagger';

export class RecordConnectionDto {
  @ApiProperty({ description: 'Which accounting tool was connected', example: 'quickbooks' })
  integrationKey!: string;

  @ApiProperty({ description: 'The connectionId returned by a successful Sync2BooksLink connect' })
  connectionId!: string;
}
