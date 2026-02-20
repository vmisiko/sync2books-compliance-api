import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * OSCU "Code Classification" reference data (cdCls).
 * Seeded from the OSCU spec; later can be refreshed from /selectCodeList.
 */
@Entity('oscu_code_classes')
export class OscuCodeClassOrmEntity {
  @PrimaryColumn('varchar')
  cdCls!: string;

  @Column('varchar')
  cdClsNm!: string;

  @Column('varchar', { nullable: true })
  cdClsDesc!: string | null;

  @Column('varchar', { nullable: true })
  userDfnNm1!: string | null;

  @Column('varchar', { nullable: true })
  userDfnNm2!: string | null;

  @Column('varchar', { nullable: true })
  userDfnNm3!: string | null;

  @Column('varchar', { default: 'Y' })
  useYn!: 'Y' | 'N';
}
