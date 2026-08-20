import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DashboardRole } from '../../../shared/domain/enums/dashboard-role.enum';

export class DashboardUserResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiPropertyOptional({ nullable: true }) displayName!: string | null;
  @ApiProperty({ enum: DashboardRole }) role!: DashboardRole;
  @ApiProperty() organizationId!: string;
}

export class DashboardOrganizationResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() displayName!: string;
}

export class DashboardTenantResponseDto {
  @ApiProperty() id!: string;
  @ApiPropertyOptional({ nullable: true }) displayName!: string | null;
  @ApiProperty({
    description:
      "The tenant's cross-service merchantId (sync2booksCompanyId when set, otherwise the tenant id itself) -- pass this as merchantId to endpoints that require one, not `id`.",
  })
  merchantId!: string;
}

export class DashboardTokensResponseDto {
  @ApiProperty() accessToken!: string;
  @ApiProperty() refreshToken!: string;
  @ApiProperty({ description: 'Seconds until accessToken expires' })
  expiresIn!: number;
  @ApiProperty({ example: 'Bearer' }) tokenType!: string;
}

export class DashboardAuthResponseDto {
  @ApiProperty({ type: DashboardUserResponseDto })
  user!: DashboardUserResponseDto;
  @ApiProperty({ type: DashboardOrganizationResponseDto })
  organization!: DashboardOrganizationResponseDto;
  @ApiProperty({ type: DashboardTokensResponseDto })
  tokens!: DashboardTokensResponseDto;
}
