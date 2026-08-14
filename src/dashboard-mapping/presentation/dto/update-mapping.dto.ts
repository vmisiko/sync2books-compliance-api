import { ApiProperty } from '@nestjs/swagger';
import type { ClassificationMatchType } from '../../../regulatory/oscu/infrastructure/persistence/classification-mapping.orm-entity';

/**
 * Body for PATCH dashboard-api/mappings/:id. Only the fields relevant to the
 * target row's actual type (tax/unit/classification, inferred server-side
 * from the id) are applied — see DashboardMappingApplicationService.update.
 */
export class UpdateMappingDto {
  // --- tax ---
  @ApiProperty({ required: false })
  internalTaxCategory?: string;

  @ApiProperty({ required: false, description: 'KRA taxTyCd' })
  taxTyCd?: string;

  // --- unit ---
  @ApiProperty({ required: false })
  internalUnit?: string;

  @ApiProperty({ required: false, description: 'KRA qtyUnitCd' })
  qtyUnitCd?: string;

  @ApiProperty({ required: false, description: 'KRA pkgUnitCd' })
  pkgUnitCd?: string;

  // --- classification ---
  @ApiProperty({ required: false, enum: ['EXTERNAL_ID', 'SKU', 'NAME_CONTAINS'] })
  matchType?: ClassificationMatchType;

  @ApiProperty({ required: false })
  matchValue?: string;

  @ApiProperty({ required: false, nullable: true })
  itemType?: string | null;

  @ApiProperty({ required: false, description: 'KRA itemClsCd' })
  itemClsCd?: string;

  @ApiProperty({ required: false })
  priority?: number;
}
