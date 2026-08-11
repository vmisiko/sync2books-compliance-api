import { ApiProperty } from '@nestjs/swagger';

/**
 * Create an "express" credit note based on an existing accepted sale.
 * The credit note will copy the sale's lines and reference the original invoice.
 */
export class CreateExpressCreditNoteDto {
  @ApiProperty()
  merchantId!: string;

  @ApiProperty()
  branchId!: string;

  @ApiProperty({ description: 'Existing sale id (ComplianceDocument.id)' })
  saleId!: string;

  @ApiProperty({ description: 'New credit note trader invoice number' })
  traderInvoiceNumber!: string;

  @ApiProperty({ description: 'Return date (YYYY-MM-DD)' })
  returnDate!: string;

  @ApiProperty({
    required: false,
    description: 'Payment type code override (defaults to original sale or 01)',
  })
  paymentTypeCode?: string;

  @ApiProperty({
    required: false,
    description:
      'Invoice status code override (defaults to original sale or 02)',
  })
  invoiceStatusCode?: string;

  @ApiProperty({
    required: false,
    description:
      'OSCU rfdRsnCd (credit note reason). Spec codes: 01 Missing Quantity, ' +
      '02 Missing data, 03 Damaged, 04 Wasted, 05 Shortage, 06 Refund. ' +
      'Defaults to 06 (Refund) -- KRA rejects a missing/invalid value.',
  })
  creditNoteReasonCode?: string;
}
