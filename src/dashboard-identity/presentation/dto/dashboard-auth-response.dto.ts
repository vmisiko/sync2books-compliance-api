import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DashboardRole } from '../../../shared/domain/enums/dashboard-role.enum';

export class DashboardUserResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiPropertyOptional({ nullable: true }) displayName!: string | null;
  @ApiProperty({ enum: DashboardRole }) role!: DashboardRole;
  @ApiProperty() complianceTenantId!: string;
}

export class DashboardTenantResponseDto {
  @ApiProperty() id!: string;
  @ApiPropertyOptional({ nullable: true }) displayName!: string | null;
}

export class DashboardTokensResponseDto {
  @ApiProperty() accessToken!: string;
  @ApiProperty() refreshToken!: string;
  @ApiProperty({ description: 'Seconds until accessToken expires' }) expiresIn!: number;
  @ApiProperty({ example: 'Bearer' }) tokenType!: string;
}

export class DashboardAuthResponseDto {
  @ApiProperty({ type: DashboardUserResponseDto }) user!: DashboardUserResponseDto;
  @ApiPropertyOptional({ type: DashboardTenantResponseDto, nullable: true })
  tenant!: DashboardTenantResponseDto | null;
  @ApiProperty({ type: DashboardTokensResponseDto }) tokens!: DashboardTokensResponseDto;
}
