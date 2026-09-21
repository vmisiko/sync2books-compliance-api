import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateApplicationDto {
  @ApiPropertyOptional({ example: 'Warehouse POS' })
  name?: string;

  @ApiPropertyOptional({ example: 'Issues sales from the till', nullable: true })
  description?: string | null;

  @ApiPropertyOptional({ enum: ['active', 'suspended'] })
  status?: 'active' | 'suspended';

  @ApiPropertyOptional({
    example: 120,
    description: 'Requests per minute across all of this application’s keys.',
  })
  rateLimitPerMin?: number;
}
