import { ApiProperty } from '@nestjs/swagger';
import { MovementType } from '../../domain/enums/movement-type.enum';

export class RecordMovementDto {
  @ApiProperty()
  itemId!: string;

  @ApiProperty()
  branchId!: string;

  @ApiProperty({ enum: MovementType })
  movementType!: MovementType;

  @ApiProperty()
  quantity!: number;

  @ApiProperty({ required: false, nullable: true })
  referenceType?: string | null;

  @ApiProperty({ required: false, nullable: true })
  referenceId?: string | null;
}
