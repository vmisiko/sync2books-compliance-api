import { ApiProperty } from '@nestjs/swagger';

export class CompleteOAuthSignUpDto {
  @ApiProperty({
    description: 'The short-lived ticket from the OAuth callback redirect',
  })
  ticket!: string;

  @ApiProperty({ example: 'Acme Retailers Ltd' })
  organizationName!: string;
}
