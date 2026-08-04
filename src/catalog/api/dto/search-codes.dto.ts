import { ApiPropertyOptional } from '@nestjs/swagger';

export class SearchCodesQueryDto {
  @ApiPropertyOptional({
    description:
      "Code group to search within, e.g. '10' (Unit of Quantity), '17' (Packaging Unit), '04' (Tax Type), '24' (Product Type), '07' (Payment Method). Omit to search across all groups.",
  })
  cdCls?: string;

  @ApiPropertyOptional({
    description: 'Filter by code prefix or name (case-insensitive contains)',
  })
  query?: string;

  @ApiPropertyOptional({
    description: 'Include codes where useYn=N (retired). Defaults to false.',
  })
  includeInactive?: string;

  @ApiPropertyOptional({
    description: 'Max rows to return (default 50, max 200)',
  })
  limit?: string;
}

export class ListCodeClassesQueryDto {
  @ApiPropertyOptional({
    description: 'Include groups where useYn=N (retired). Defaults to false.',
  })
  includeInactive?: string;
}
