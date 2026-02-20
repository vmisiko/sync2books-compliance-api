import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * OSCU "Code" reference data within a Code Classification (cdCls).
 * Seeded from the OSCU spec; later can be refreshed from /selectCodeList.
 */
@Entity('oscu_codes')
@Index(['cdCls', 'cd'], { unique: true })
export class OscuCodeOrmEntity {
  @PrimaryColumn('varchar')
  cdCls!: string;

  @PrimaryColumn('varchar')
  cd!: string;

  @Column('varchar')
  cdNm!: string;

  @Column('varchar', { nullable: true })
  cdDesc!: string | null;

  @Column('int', { nullable: true })
  srtOrd!: number | null;

  @Column('varchar', { default: 'Y' })
  useYn!: 'Y' | 'N';

  @Column('varchar', { nullable: true })
  userDfnCd1!: string | null;

  @Column('varchar', { nullable: true })
  userDfnCd2!: string | null;

  @Column('varchar', { nullable: true })
  userDfnCd3!: string | null;
}
