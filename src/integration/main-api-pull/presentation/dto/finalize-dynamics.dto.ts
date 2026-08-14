import { ApiProperty } from '@nestjs/swagger';

export class FinalizeDynamicsDto {
  @ApiProperty({ description: 'Business Central company id (GUID)' })
  bookCompanyId!: string;
}
