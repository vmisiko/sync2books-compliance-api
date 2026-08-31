import { ApiProperty } from '@nestjs/swagger';

export class ResyncOscuSequenceDto {
  @ApiProperty({
    description: 'Merchant whose eTIMS connection (tin) to resync against.',
  })
  merchantId!: string;

  @ApiProperty()
  branchId!: string;
}
