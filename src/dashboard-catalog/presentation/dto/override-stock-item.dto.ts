import { ApiProperty } from '@nestjs/swagger';

export class OverrideStockItemDto {
  @ApiProperty({
    description:
      'Whether this item requires KRA stock tracking (insertStockIO etc), overriding the QuickBooks-derived default',
  })
  isStockItem!: boolean;
}
