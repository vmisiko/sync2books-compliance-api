import { ApiProperty } from '@nestjs/swagger';

export class InitializeEtimsDto {
  @ApiProperty({
    required: false,
    nullable: true,
    description:
      'Device serial for OSCU initialize. If omitted, uses `dvcSrlNo` stored on the connection (from PUT etims-connection).',
  })
  dvcSrlNo?: string | null;
}
