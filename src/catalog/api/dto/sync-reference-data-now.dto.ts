import { ApiPropertyOptional } from '@nestjs/swagger';

export class SyncReferenceDataNowDto {
  @ApiPropertyOptional({
    description:
      "Ignore each environment's stored watermark (lastReqDt) and re-pull the full reference list instead of just what's new.",
  })
  full?: boolean;
}
