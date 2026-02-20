import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('oscu_item_classifications')
export class OscuItemClassificationOrmEntity {
  @PrimaryColumn('varchar')
  itemClsCd!: string;

  @Column('varchar')
  @Index()
  itemClsNm!: string;

  @Column('int')
  itemClsLvl!: number;

  @Column('varchar', { nullable: true })
  taxTyCd!: string | null;

  @Column('varchar', { nullable: true })
  mjrTgYn!: string | null;

  @Column('varchar', { default: 'Y' })
  useYn!: 'Y' | 'N';

  @Column('datetime', { nullable: true })
  lastSyncedAt!: Date | null;
}
