import { ApiProperty } from '@nestjs/swagger';
import { ConnectionEnvironment } from '../../../shared/domain/enums/connection-environment.enum';
import { ConnectionStatus } from '../../../shared/domain/enums/connection-status.enum';

export class UpsertEtimsConnectionDto {
  @ApiProperty()
  kraPin!: string;

  @ApiProperty({
    description:
      'OSCU device id (`dvcId`) after initialize; placeholder until init if needed',
  })
  deviceId!: string;

  @ApiProperty({
    description: 'CMC key from initialize; placeholder until init if needed',
  })
  cmcKey!: string;

  @ApiProperty({
    required: false,
    nullable: true,
    description:
      'Device serial sent in initialize request body (`dvcSrlNo`). Not the same as deviceId (OSCU `dvcId`).',
  })
  dvcSrlNo?: string | null;

  @ApiProperty({ enum: ConnectionEnvironment })
  environment!: ConnectionEnvironment;

  @ApiProperty({ enum: ConnectionStatus, required: false })
  status?: ConnectionStatus;

  @ApiProperty({ required: false, nullable: true })
  sync2booksConnectionId?: string | null;
}
