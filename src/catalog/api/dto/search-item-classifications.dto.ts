import { ApiPropertyOptional } from '@nestjs/swagger';

export class SearchItemClassificationsQueryDto {
  @ApiPropertyOptional({
    description:
      'Filter by item classification code prefix or name (case-insensitive contains)',
  })
  query?: string;

  @ApiPropertyOptional({ description: 'Filter by classification level (1-5)' })
  itemClsLvl?: string;

  @ApiPropertyOptional({
    description: 'Include codes where useYn=N (retired). Defaults to false.',
  })
  includeInactive?: string;

  @ApiPropertyOptional({
    description: 'Max rows to return (default 20, max 100)',
  })
  limit?: string;
}
