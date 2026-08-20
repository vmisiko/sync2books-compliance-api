import { ApiPropertyOptional } from '@nestjs/swagger';
import { DashboardRole } from '../../../shared/domain/enums/dashboard-role.enum';
import type { DashboardUserStatus } from '../../domain/entities/dashboard-user.entity';

export class UpdateMemberDto {
  @ApiPropertyOptional({ enum: DashboardRole })
  role?: DashboardRole;

  @ApiPropertyOptional({ enum: ['active', 'deactivated'] })
  status?: DashboardUserStatus;
}
