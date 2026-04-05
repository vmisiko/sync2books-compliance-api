import { ApiProperty } from '@nestjs/swagger';

export class UpsertTenantDto {
  @ApiProperty({
    required: false,
    nullable: true,
    description:
      'Internal Compliance tenant id. Send when updating a tenant created without a Sync2Books company id.',
  })
  id?: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    description:
      'Sync2Books company id when integrating with the main Sync2Books API; omit for compliance-dashboard-only tenants.',
  })
  sync2booksCompanyId?: string | null;

  @ApiProperty({ required: false, nullable: true })
  displayName?: string | null;
}
