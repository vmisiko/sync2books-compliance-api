import { ApiProperty } from '@nestjs/swagger';

export class EmailReceiptDto {
  @ApiProperty({
    required: false,
    description: 'Overrides the sale\'s stored customer email, if any',
  })
  email?: string;
}
