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
