import { ApiProperty } from '@nestjs/swagger';

export class OverrideItemClassificationDto {
  @ApiProperty({
    description:
      'OSCU item classification code (itemClsCd) to force for this item',
    example: '14111400',
  })
  classificationCode!: string;
}
