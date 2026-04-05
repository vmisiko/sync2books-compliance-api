import { ApiProperty } from '@nestjs/swagger';

export class UpsertBranchDto {
  @ApiProperty({
    required: false,
    nullable: true,
    description:
      'Internal branch id. Send when updating a branch that has no Sync2Books branch id.',
  })
  id?: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    description:
      'Sync2Books branch / location id when linked to the main product; omit for dashboard-only branches.',
  })
  sync2booksBranchId?: string | null;

  @ApiProperty({ required: false, nullable: true })
  displayName?: string | null;

  @ApiProperty({ required: false, nullable: true })
  kraBhfId?: string | null;
}
