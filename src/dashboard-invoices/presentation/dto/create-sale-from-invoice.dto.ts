import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSaleFromInvoiceDto {
  @ApiPropertyOptional({
    description: 'Submit to eTIMS immediately after creating the sale.',
    default: true,
  })
  submit?: boolean;
}
