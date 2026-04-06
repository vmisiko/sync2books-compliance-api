import { ApiProperty } from '@nestjs/swagger';
import type { ComplianceConnection } from '../../../shared/domain/entities/compliance-connection.entity';
import type { ComplianceTenant } from '../../domain/entities/compliance-tenant.entity';

/** Response for POST /tenants when provisioning includes default branch + optional eTIMS shell. */
export class TenantUpsertResponseDto {
  @ApiProperty()
  tenant!: ComplianceTenant;

  @ApiProperty({
    description:
      'Internal id of the default branch (Headquarters), used for eTIMS routes.',
  })
  defaultBranchId!: string;

  @ApiProperty({
    required: false,
    nullable: true,
    description:
      'Present when `kraPin` was sent: eTIMS connection shell on the default branch.',
  })
  etimsConnection!: ComplianceConnection | null;
}
