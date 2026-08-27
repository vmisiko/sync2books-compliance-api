import { ApiProperty } from '@nestjs/swagger';

/**
 * Body for POST dashboard-api/mappings. `type` selects which fields are
 * required — see DashboardMappingApplicationService.createManual for the
 * per-type validation (this codebase doesn't use class-validator elsewhere,
 * so validation is done in the application layer to match convention).
 */
export class CreateMappingDto {
  @ApiProperty({ enum: ['tax', 'payment', 'quantity_unit'] })
  type!: 'tax' | 'payment' | 'quantity_unit';

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

  // --- quantity_unit (category-based, like tax) ---
  @ApiProperty({
    required: false,
    description: 'Required when type=quantity_unit',
    example: 'KILOGRAM',
  })
  internalUnit?: string;

  @ApiProperty({
    required: false,
    description: "Required when type=quantity_unit — KRA quantity unit code (cdCls '10')",
    example: 'KG',
  })
  qtyUnitCd?: string;
}
