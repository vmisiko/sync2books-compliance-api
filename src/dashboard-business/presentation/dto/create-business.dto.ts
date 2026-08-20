import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateBusinessDto {
  @ApiProperty({ example: 'Acme Retailers Ltd' })
  displayName!: string;

  @ApiPropertyOptional({ example: 'A009818366S', description: 'KRA PIN No.' })
  kraPin?: string;

  @ApiPropertyOptional({
    description: 'true = Live (PRODUCTION), false/omitted = Test (SANDBOX)',
    default: false,
  })
  isLiveBusiness?: boolean;
}
