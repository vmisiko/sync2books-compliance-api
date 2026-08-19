import { ApiProperty } from '@nestjs/swagger';
import type { ClassificationMatchType } from '../../../regulatory/oscu/infrastructure/persistence/classification-mapping.orm-entity';

/**
 * Body for POST dashboard-api/mappings. `type` selects which fields are
 * required — see DashboardMappingApplicationService.createManual for the
 * per-type validation (this codebase doesn't use class-validator elsewhere,
 * so validation is done in the application layer to match convention).
 */
export class CreateMappingDto {
  @ApiProperty({ enum: ['tax', 'classification', 'payment'] })
  type!: 'tax' | 'classification' | 'payment';

  // --- tax ---
  @ApiProperty({
    required: false,
    description: 'Required when type=tax',
    example: 'VAT_STANDARD',
  })
  internalTaxCategory?: string;

  @ApiProperty({
    required: false,
    description: 'Required when type=tax — KRA taxTyCd',
    example: 'B',
  })
  taxTyCd?: string;

  // --- classification (also carries this item's own qtyUnitCd/pkgUnitCd —
  // resolved per item, not via a shared category, see
  // ClassificationMappingOrmEntity's doc comment) ---
  @ApiProperty({
    required: false,
    enum: ['EXTERNAL_ID', 'SKU', 'NAME_CONTAINS'],
    description: 'Required when type=classification',
  })
  matchType?: ClassificationMatchType;

  @ApiProperty({
    required: false,
    description: 'Required when type=classification',
  })
  matchValue?: string;

  @ApiProperty({ required: false, nullable: true })
  itemType?: string | null;

  @ApiProperty({
    required: false,
    description: 'Required when type=classification — KRA itemClsCd',
    example: '14111400',
  })
  itemClsCd?: string;

  @ApiProperty({
    required: false,
    description: "This item's KRA quantity unit code (cdCls '10')",
    example: 'KG',
  })
  qtyUnitCd?: string;

  @ApiProperty({
    required: false,
    description: "This item's KRA packaging unit code (cdCls '17')",
    example: 'BG',
  })
  pkgUnitCd?: string;

  @ApiProperty({ required: false, default: 100 })
  priority?: number;

  // --- payment ---
  @ApiProperty({
    required: false,
    description: 'Required when type=payment',
    example: 'MOBILE_MONEY',
  })
  internalPaymentMethod?: string;

  @ApiProperty({
    required: false,
    description: "Required when type=payment — OSCU pmtTyCd (cdCls '07')",
    example: '07',
  })
  pmtTyCd?: string;
}
