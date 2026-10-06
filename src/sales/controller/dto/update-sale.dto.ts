import { ApiProperty } from '@nestjs/swagger';

/**
 * Editable header fields of a not-yet-submitted manual sale. Every field is
 * optional (PATCH semantics); send `null` or '' to clear a nullable one.
 * Lines/amounts are intentionally not editable here -- inventory movements are
 * applied when the sale is created, so changing quantities needs its own flow.
 */
export class UpdateSaleDto {
  @ApiProperty({ required: false, nullable: true, description: 'Customer KRA PIN (P/A + 9 digits + letter)' })
  customerTin?: string | null;

  @ApiProperty({ required: false, nullable: true })
  customerName?: string | null;

  @ApiProperty({ required: false, nullable: true })
  customerPhoneNumber?: string | null;

  @ApiProperty({ required: false, nullable: true })
  customerEmail?: string | null;

  @ApiProperty({ required: false, description: 'YYYY-MM-DD' })
  saleDate?: string;

  @ApiProperty({ required: false, description: 'Payment type code, 01..08' })
  paymentTypeCode?: string;
}
