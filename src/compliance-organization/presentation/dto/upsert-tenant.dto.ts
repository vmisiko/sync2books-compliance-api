import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ConnectionEnvironment } from '../../../shared/domain/enums/connection-environment.enum';

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

  @ApiPropertyOptional({
    nullable: true,
    description:
      'KRA PIN / TIN (DigiTax “PIN No.”). When set, creates or updates the eTIMS connection shell on the default Headquarters branch.',
    example: 'A123456789B',
  })
  kraPin?: string | null;

  @ApiPropertyOptional({
    enum: ConnectionEnvironment,
    description:
      'SANDBOX = Test, PRODUCTION = Live. Takes precedence over `isLiveBusiness`.',
  })
  environment?: ConnectionEnvironment;

  @ApiPropertyOptional({
    description:
      'false = Test (SANDBOX), true = Live (PRODUCTION). Ignored when `environment` is set.',
  })
  isLiveBusiness?: boolean;
}
