import { ApiProperty } from '@nestjs/swagger';

export class UpsertMainApiConnectionDto {
  @ApiProperty({
    description: "This tenant's Application id on the main Sync2Books API",
    example: '564d849f-c35b-4cb7-b5d9-e51fb10a57a8',
  })
  mainApiApplicationId!: string;

  @ApiProperty({
    description:
      "That Application's x-api-key (from the main API's Application credentials page)",
    example: 'sk_development_...',
  })
  mainApiApiKey!: string;
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
