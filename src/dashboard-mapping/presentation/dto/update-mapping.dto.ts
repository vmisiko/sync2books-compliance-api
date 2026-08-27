import { ApiProperty } from '@nestjs/swagger';

/**
 * Body for PATCH dashboard-api/mappings/:id. Only the fields relevant to the
 * target row's actual type (tax/payment/quantity_unit, inferred server-side
 * from the id's prefix) are applied — see DashboardMappingApplicationService.update.
 */
export class UpdateMappingDto {
  // --- tax ---
  @ApiProperty({ required: false })
  internalTaxCategory?: string;

  @ApiProperty({ required: false, description: 'KRA taxTyCd' })
  taxTyCd?: string;

  // --- payment ---
  @ApiProperty({
    required: false,
    description: 'Internal payment-method key, e.g. MOBILE_MONEY',
  })
  internalPaymentMethod?: string;

  @ApiProperty({ required: false, description: "OSCU pmtTyCd (cdCls '07')" })
  pmtTyCd?: string;

  // --- quantity_unit (category-based, like tax) ---
  @ApiProperty({
    required: false,
    description: 'Internal unit bucket key, e.g. KILOGRAM, PIECES',
  })
  internalUnit?: string;

  @ApiProperty({
    required: false,
    description: "KRA quantity unit code (cdCls '10')",
  })
  qtyUnitCd?: string;
}
