import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateApplicationDto {
  @ApiProperty({ example: 'Warehouse POS' })
  name!: string;

  @ApiPropertyOptional({ example: 'Issues sales from the till' })
  description?: string;
}
