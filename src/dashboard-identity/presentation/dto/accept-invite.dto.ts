import { ApiProperty } from '@nestjs/swagger';

export class AcceptInviteDto {
  @ApiProperty({ description: 'The token from the invite link\'s #token fragment.' })
  token!: string;

  @ApiProperty({ example: 'SecurePass123', minLength: 8 })
  password!: string;
}
