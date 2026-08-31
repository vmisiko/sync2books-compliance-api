import { ApiPropertyOptional } from '@nestjs/swagger';

export class InvoiceLineOverrideDto {
  @ApiPropertyOptional({
    description:
      "Index into the pulled invoice's `lines` array (as returned by GET /invoices/:id) that this override applies to.",
  })
  index!: number;

  @ApiPropertyOptional({
    description: 'Override the line description/item name.',
  })
  description?: string;

  @ApiPropertyOptional({ description: 'Override the line quantity.' })
  quantity?: number;

  @ApiPropertyOptional({ description: 'Override the line unit price.' })
  unitAmount?: number;
}

export class CreateSaleFromInvoiceDto {
  @ApiPropertyOptional({
    description: 'Submit to eTIMS immediately after creating the sale.',
    default: true,
  })
  submit?: boolean;

  @ApiPropertyOptional({
    description:
      "Override the customer's KRA PIN for this sale (the pulled invoice's own ERP data rarely carries one). Applies to this submission only -- never written back to the source ERP.",
  })
  customerPin?: string;

  @ApiPropertyOptional({
    description:
      'Override the customer name for this sale. Applies to this submission only.',
  })
  customerName?: string;

  @ApiPropertyOptional({
    description:
      'Override the customer phone number for this sale. Applies to this submission only.',
  })
  customerPhoneNumber?: string;

  @ApiPropertyOptional({
    description:
      'Override the customer email for this sale. Applies to this submission only.',
  })
  customerEmail?: string;

  @ApiPropertyOptional({
    description:
      "Per-line overrides (description/quantity/unitAmount), keyed by the pulled invoice's own line index. Applies to this submission only -- never written back to the source ERP.",
    type: [InvoiceLineOverrideDto],
  })
  lineOverrides?: InvoiceLineOverrideDto[];
}
