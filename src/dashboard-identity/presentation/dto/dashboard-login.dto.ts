import { ApiProperty } from '@nestjs/swagger';

export class DashboardLoginDto {
  @ApiProperty({ example: 'dev@sync2books.local' })
  email!: string;

  @ApiProperty({ example: 'DevPassword123!' })
  password!: string;
}
