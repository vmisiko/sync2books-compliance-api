import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ConnectionEnvironment } from '../../../shared/domain/enums/connection-environment.enum';
import { ALL_API_KEY_SCOPES } from '../../domain/api-key-scope.enum';

export class CreateApiKeyDto {
  @ApiProperty({
    enum: ConnectionEnvironment,
    description:
      'A SANDBOX key may only act on sandbox businesses, a PRODUCTION key only on production ones.',
  })
  environment!: ConnectionEnvironment;

  @ApiPropertyOptional({
    description:
      'The business this key is for. Calls made with the key then need no businessId, and any other business is refused. Required unless allBusinesses is true.',
  })
  businessId?: string;

  @ApiPropertyOptional({
    description:
      'Set true for an organisation-wide key that names its business on every call. Cannot be combined with businessId.',
  })
  allBusinesses?: boolean;

  @ApiPropertyOptional({ example: 'Till 1 — production' })
  name?: string;

  @ApiPropertyOptional({
    isArray: true,
    enum: ALL_API_KEY_SCOPES,
    description: 'Omit to grant every scope.',
  })
  scopes?: string[];

  @ApiPropertyOptional({
    example: '2027-01-01T00:00:00.000Z',
    description: 'Optional expiry. Must be in the future.',
  })
  expiresAt?: string;
}
