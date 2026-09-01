import { ApiProperty } from '@nestjs/swagger';

export class AcceptPasswordResetDto {
  @ApiProperty({ description: 'The token from the reset link\'s #token fragment.' })
  token!: string;

  @ApiProperty({ example: 'SecurePass123', minLength: 8 })
  password!: string;
}
