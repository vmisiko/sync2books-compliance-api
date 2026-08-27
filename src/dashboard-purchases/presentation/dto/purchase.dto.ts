import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PullPurchasesDto {
  @ApiPropertyOptional({
    description:
      'Compliance branch id to pull for. Omit to pull every branch with an active eTIMS connection.',
  })
  branchId?: string;

  @ApiPropertyOptional({
    description:
      'Newly-pulled invoices are marked pending_review instead of pulled.',
    default: true,
  })
  autoMarkPendingReview?: boolean;
}

export class PurchaseIdsDto {
  @ApiProperty({ type: [String] })
  ids!: string[];
}

export class LinkSupplierDto {
  @ApiProperty({
    description: 'dashboard_suppliers.id to link this purchase invoice to',
  })
  supplierId!: string;
}

export class CreateSupplierFromPurchaseDto {
  @ApiPropertyOptional({
    description:
      'Optional contact details to fill in on the new Supplier -- eTIMS purchase data only ever carries name/PIN, so these are never pre-filled from the purchase itself. Ignored if a Supplier with this PIN already exists (this call links to it instead of creating a duplicate, and never overwrites its existing contact details).',
  })
  phoneNumber?: string;

  @ApiPropertyOptional({ description: 'See phoneNumber.' })
  email?: string;
}

export class RegisterPurchaseLineItemDto {
  @ApiProperty({
    description:
      "OSCU itemTyCd -- '1' Raw Material, '2' Finished Product, '3' Service. The only field this endpoint can't fill in from the KRA purchase data itself; never guessed.",
    enum: ['1', '2', '3'],
  })
  productTypeCode!: string;
}
