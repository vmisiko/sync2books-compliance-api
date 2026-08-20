import { ApiProperty } from '@nestjs/swagger';

export class UpdateOrganizationDto {
  @ApiProperty({ example: 'Acme Retailers Ltd' })
  displayName!: string;
}
