import { ApiProperty } from '@nestjs/swagger';
import type { ClassificationMatchType } from '../../../regulatory/oscu/infrastructure/persistence/classification-mapping.orm-entity';

/**
 * Body for POST dashboard-api/mappings. `type` selects which fields are
 * required — see DashboardMappingApplicationService.createManual for the
 * per-type validation (this codebase doesn't use class-validator elsewhere,
 * so validation is done in the application layer to match convention).
 */
export class CreateMappingDto {
  @ApiProperty({ enum: ['tax', 'unit', 'classification'] })
  type!: 'tax' | 'unit' | 'classification';

  // --- tax ---
  @ApiProperty({ required: false, description: 'Required when type=tax', example: 'VAT_STANDARD' })
  internalTaxCategory?: string;

  @ApiProperty({ required: false, description: 'Required when type=tax — KRA taxTyCd', example: 'B' })
  taxTyCd?: string;

  // --- unit ---
  @ApiProperty({ required: false, description: 'Required when type=unit', example: 'KG' })
  internalUnit?: string;

  @ApiProperty({ required: false, description: 'Required when type=unit — KRA qtyUnitCd', example: 'KG' })
  qtyUnitCd?: string;

  @ApiProperty({ required: false, description: 'Required when type=unit — KRA pkgUnitCd', example: 'NT' })
  pkgUnitCd?: string;

  // --- classification ---
  @ApiProperty({ required: false, enum: ['EXTERNAL_ID', 'SKU', 'NAME_CONTAINS'], description: 'Required when type=classification' })
  matchType?: ClassificationMatchType;

  @ApiProperty({ required: false, description: 'Required when type=classification' })
  matchValue?: string;

  @ApiProperty({ required: false, nullable: true })
  itemType?: string | null;

  @ApiProperty({ required: false, description: 'Required when type=classification — KRA itemClsCd', example: '14111400' })
  itemClsCd?: string;

  @ApiProperty({ required: false, default: 100 })
  priority?: number;
}
