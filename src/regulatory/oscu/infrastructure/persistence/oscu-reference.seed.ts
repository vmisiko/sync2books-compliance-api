import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OscuCodeClassOrmEntity } from './oscu-code-class.orm-entity';
import { OscuCodeOrmEntity } from './oscu-code.orm-entity';

type SeedCodeClass = Pick<
  OscuCodeClassOrmEntity,
  | 'cdCls'
  | 'cdClsNm'
  | 'cdClsDesc'
  | 'userDfnNm1'
  | 'userDfnNm2'
  | 'userDfnNm3'
  | 'useYn'
>;

type SeedCode = Pick<
  OscuCodeOrmEntity,
  | 'cdCls'
  | 'cd'
  | 'cdNm'
  | 'cdDesc'
  | 'srtOrd'
  | 'useYn'
  | 'userDfnCd1'
  | 'userDfnCd2'
  | 'userDfnCd3'
>;

/**
 * Minimal seed to unblock item registration + mapping dropdowns.
 *
 * Important:
 * - This is NOT the full KRA dataset.
 * - Later, implement a "sync" use-case that calls /selectCodeList and upserts into these tables.
 */
@Injectable()
export class OscuReferenceSeed {
  constructor(
    @InjectRepository(OscuCodeClassOrmEntity)
    private readonly classesRepo: Repository<OscuCodeClassOrmEntity>,
    @InjectRepository(OscuCodeOrmEntity)
    private readonly codesRepo: Repository<OscuCodeOrmEntity>,
  ) {}

  async runIfEmpty(): Promise<void> {
    const count = await this.classesRepo.count();
    if (count > 0) return;

    const classes: SeedCodeClass[] = [
      {
        cdCls: '04',
        cdClsNm: 'Tax Type',
        cdClsDesc: null,
        userDfnNm1: null,
        userDfnNm2: null,
        userDfnNm3: null,
        useYn: 'Y',
      },
      {
        cdCls: '10',
        cdClsNm: 'Unit of Quantity',
        cdClsDesc: null,
        userDfnNm1: null,
        userDfnNm2: null,
        userDfnNm3: null,
        useYn: 'Y',
      },
      {
        cdCls: '17',
        cdClsNm: 'Packaging Unit',
        cdClsDesc: null,
        userDfnNm1: null,
        userDfnNm2: null,
        userDfnNm3: null,
        useYn: 'Y',
      },
      {
        cdCls: '24',
        cdClsNm: 'Product Type',
        cdClsDesc: null,
        userDfnNm1: null,
        userDfnNm2: null,
        userDfnNm3: null,
        useYn: 'Y',
      },
      {
        cdCls: '07',
        cdClsNm: 'Payment Method',
        cdClsDesc: null,
        userDfnNm1: null,
        userDfnNm2: null,
        userDfnNm3: null,
        useYn: 'Y',
      },
    ];

    const codes: SeedCode[] = [
      // 04 - Tax Type (spec section 4.1)
      {
        cdCls: '04',
        cd: 'A',
        cdNm: 'Exempt',
        cdDesc: 'Exempt',
        srtOrd: 1,
        useYn: 'Y',
        userDfnCd1: null,
        userDfnCd2: null,
        userDfnCd3: null,
      },
      {
        cdCls: '04',
        cd: 'B',
        cdNm: 'VAT Standard',
        cdDesc: 'VAT Standard Rate',
        srtOrd: 2,
        useYn: 'Y',
        userDfnCd1: null,
        userDfnCd2: null,
        userDfnCd3: null,
      },
      {
        cdCls: '04',
        cd: 'C',
        cdNm: 'VAT 0%',
        cdDesc: 'VAT 0%',
        srtOrd: 3,
        useYn: 'Y',
        userDfnCd1: null,
        userDfnCd2: null,
        userDfnCd3: null,
      },
      {
        cdCls: '04',
        cd: 'D',
        cdNm: 'Non-VAT',
        cdDesc: 'Non-VAT',
        srtOrd: 4,
        useYn: 'Y',
        userDfnCd1: null,
        userDfnCd2: null,
        userDfnCd3: null,
      },
      {
        cdCls: '04',
        cd: 'E',
        cdNm: 'VAT 8%',
        cdDesc: 'VAT 8%',
        srtOrd: 5,
        useYn: 'Y',
        userDfnCd1: null,
        userDfnCd2: null,
        userDfnCd3: null,
      },

      // 24 - Product Type (spec section 4.3)
      {
        cdCls: '24',
        cd: '1',
        cdNm: 'Raw Material',
        cdDesc: 'Raw Material',
        srtOrd: 1,
        useYn: 'Y',
        userDfnCd1: null,
        userDfnCd2: null,
        userDfnCd3: null,
      },
      {
        cdCls: '24',
        cd: '2',
        cdNm: 'Finished Product',
        cdDesc: 'Finished Product',
        srtOrd: 2,
        useYn: 'Y',
        userDfnCd1: null,
        userDfnCd2: null,
        userDfnCd3: null,
      },
      {
        cdCls: '24',
        cd: '3',
        cdNm: 'Service',
        cdDesc: 'Service without stock',
        srtOrd: 3,
        useYn: 'Y',
        userDfnCd1: null,
        userDfnCd2: null,
        userDfnCd3: null,
      },

      // 10 - Unit of Quantity (spec section 4.7) – minimal common set
      {
        cdCls: '10',
        cd: 'U',
        cdNm: 'Pieces/item',
        cdDesc: 'Pieces/item',
        srtOrd: null,
        useYn: 'Y',
        userDfnCd1: null,
        userDfnCd2: null,
        userDfnCd3: null,
      },
      {
        cdCls: '10',
        cd: 'KG',
        cdNm: 'Kilo-Gramme',
        cdDesc: 'Kilo-Gramme',
        srtOrd: null,
        useYn: 'Y',
        userDfnCd1: null,
        userDfnCd2: null,
        userDfnCd3: null,
      },
      {
        cdCls: '10',
        cd: 'LTR',
        cdNm: 'Litre',
        cdDesc: 'Litre',
        srtOrd: null,
        useYn: 'Y',
        userDfnCd1: null,
        userDfnCd2: null,
        userDfnCd3: null,
      },

      // 17 - Packaging Unit (spec section 4.6) – minimal common set
      {
        cdCls: '17',
        cd: 'NT',
        cdNm: 'NET',
        cdDesc: 'Packaging Unit (NET)',
        srtOrd: null,
        useYn: 'Y',
        userDfnCd1: null,
        userDfnCd2: null,
        userDfnCd3: null,
      },
      {
        cdCls: '17',
        cd: 'BL',
        cdNm: 'Bale',
        cdDesc: 'Bale',
        srtOrd: null,
        useYn: 'Y',
        userDfnCd1: null,
        userDfnCd2: null,
        userDfnCd3: null,
      },
      {
        cdCls: '17',
        cd: 'BX',
        cdNm: 'Box',
        cdDesc: 'Box',
        srtOrd: null,
        useYn: 'Y',
        userDfnCd1: null,
        userDfnCd2: null,
        userDfnCd3: null,
      },

      // 07 - Payment Method (spec section 4.11)
      // Note: The extracted PDF text lists the labels but not the numeric cd values.
      // We seed the commonly-used OSCU pattern (01..08) and will reconcile via /selectCodeList sync later.
      {
        cdCls: '07',
        cd: '01',
        cdNm: 'CASH',
        cdDesc: 'CASH',
        srtOrd: 1,
        useYn: 'Y',
        userDfnCd1: null,
        userDfnCd2: null,
        userDfnCd3: null,
      },
      {
        cdCls: '07',
        cd: '02',
        cdNm: 'CREDIT',
        cdDesc: 'CREDIT',
        srtOrd: 2,
        useYn: 'Y',
        userDfnCd1: null,
        userDfnCd2: null,
        userDfnCd3: null,
      },
      {
        cdCls: '07',
        cd: '03',
        cdNm: 'CASH/CREDIT',
        cdDesc: 'CASH/CREDIT',
        srtOrd: 3,
        useYn: 'Y',
        userDfnCd1: null,
        userDfnCd2: null,
        userDfnCd3: null,
      },
      {
        cdCls: '07',
        cd: '04',
        cdNm: 'BANK CHECK',
        cdDesc: 'BANK CHECK PAYMENT',
        srtOrd: 4,
        useYn: 'Y',
        userDfnCd1: null,
        userDfnCd2: null,
        userDfnCd3: null,
      },
      {
        cdCls: '07',
        cd: '05',
        cdNm: 'DEBIT&CREDIT',
        cdDesc: 'DEBIT&CREDIT',
        srtOrd: 5,
        useYn: 'Y',
        userDfnCd1: null,
        userDfnCd2: null,
        userDfnCd3: null,
      },
      {
        cdCls: '07',
        cd: '06',
        cdNm: 'CARD',
        cdDesc: 'PAYMENT USING CARD',
        srtOrd: 6,
        useYn: 'Y',
        userDfnCd1: null,
        userDfnCd2: null,
        userDfnCd3: null,
      },
      {
        cdCls: '07',
        cd: '07',
        cdNm: 'MOBILE MONEY',
        cdDesc: 'ANY TRANSACTION USING MOBILE MONEY SYSTEM',
        srtOrd: 7,
        useYn: 'Y',
        userDfnCd1: null,
        userDfnCd2: null,
        userDfnCd3: null,
      },
      {
        cdCls: '07',
        cd: '08',
        cdNm: 'OTHER',
        cdDesc: 'OTHER MEANS OF PAYMENT',
        srtOrd: 8,
        useYn: 'Y',
        userDfnCd1: null,
        userDfnCd2: null,
        userDfnCd3: null,
      },
    ];

    await this.classesRepo.save(classesRepoCreate(this.classesRepo, classes));
    await this.codesRepo.save(codesRepoCreate(this.codesRepo, codes));
  }
}

function classesRepoCreate(
  repo: Repository<OscuCodeClassOrmEntity>,
  items: SeedCodeClass[],
): OscuCodeClassOrmEntity[] {
  return items.map((i) => repo.create(i));
}

function codesRepoCreate(
  repo: Repository<OscuCodeOrmEntity>,
  items: SeedCode[],
): OscuCodeOrmEntity[] {
  return items.map((i) => repo.create(i));
}
