import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ConnectOdooDto {
  @ApiProperty({ example: 'https://my-company.odoo.com' })
  url!: string;

  @ApiProperty({ example: 'my-company' })
  database!: string;

  @ApiProperty({ example: 'you@example.com' })
  username!: string;

  @ApiProperty({ description: 'Odoo API key (Settings > Users > API Keys)' })
  apiKey!: string;

  @ApiPropertyOptional({
    description: 'Existing connectionId, when reconnecting',
  })
  connectionId?: string;
}
