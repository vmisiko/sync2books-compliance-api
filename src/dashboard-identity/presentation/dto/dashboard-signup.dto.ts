import { ApiProperty } from '@nestjs/swagger';

export class DashboardSignUpDto {
  @ApiProperty({ example: 'Acme Retailers Ltd' })
  organizationName!: string;

  @ApiProperty({ example: 'Jane' })
  firstName!: string;

  @ApiProperty({ example: 'Wanjiru' })
  lastName!: string;

  @ApiProperty({ example: 'jane@acmeretailers.co.ke' })
  email!: string;

  @ApiProperty({ example: 'SecurePass123', minLength: 8 })
  password!: string;
}
