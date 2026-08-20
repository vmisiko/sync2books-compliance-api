import { ApiProperty } from '@nestjs/swagger';
import { DashboardRole } from '../../../shared/domain/enums/dashboard-role.enum';

export class CreateMemberDto {
  @ApiProperty({ example: 'accountant@acmeretailers.co.ke' })
  email!: string;

  @ApiProperty({ example: 'Peter Otieno' })
  displayName!: string;

  @ApiProperty({ enum: DashboardRole, example: DashboardRole.ACCOUNTANT })
  role!: DashboardRole;
}
