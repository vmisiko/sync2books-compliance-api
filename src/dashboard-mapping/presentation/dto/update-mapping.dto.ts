import { ApiProperty } from '@nestjs/swagger';
import type { ClassificationMatchType } from '../../../regulatory/oscu/infrastructure/persistence/classification-mapping.orm-entity';

/**
 * Body for PATCH dashboard-api/mappings/:id. Only the fields relevant to the
 * target row's actual type (tax/classification, inferred server-side from
 * the id) are applied — see DashboardMappingApplicationService.update.
 */
export class UpdateMappingDto {
  // --- tax ---
  @ApiProperty({ required: false })
  internalTaxCategory?: string;

  @ApiProperty({ required: false, description: 'KRA taxTyCd' })
  taxTyCd?: string;

  // --- classification (itemClsCd/qtyUnitCd/pkgUnitCd are three independent
  // per-item fields — any subset may be sent; the row only becomes
  // MAPPED/active once all three are present) ---
  @ApiProperty({
    required: false,
    enum: ['EXTERNAL_ID', 'SKU', 'NAME_CONTAINS'],
  })
  matchType?: ClassificationMatchType;

  @ApiProperty({ required: false })
  matchValue?: string;

  @ApiProperty({ required: false, nullable: true })
  itemType?: string | null;

  @ApiProperty({ required: false, description: 'KRA itemClsCd' })
  itemClsCd?: string;

  @ApiProperty({
    required: false,
    description: "This item's KRA quantity unit code (cdCls '10')",
  })
  qtyUnitCd?: string;

  @ApiProperty({
    required: false,
    description: "This item's KRA packaging unit code (cdCls '17')",
  })
  pkgUnitCd?: string;

  @ApiProperty({ required: false })
  priority?: number;

  // --- payment ---
  @ApiProperty({
    required: false,
    description: 'Internal payment-method key, e.g. MOBILE_MONEY',
  })
  internalPaymentMethod?: string;

  @ApiProperty({ required: false, description: "OSCU pmtTyCd (cdCls '07')" })
  pmtTyCd?: string;
}
