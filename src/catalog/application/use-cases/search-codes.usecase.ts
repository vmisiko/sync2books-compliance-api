import type { Repository } from 'typeorm';
import { OscuCodeClassOrmEntity } from '../../../regulatory/oscu/infrastructure/persistence/oscu-code-class.orm-entity';
import { OscuCodeOrmEntity } from '../../../regulatory/oscu/infrastructure/persistence/oscu-code.orm-entity';

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

export async function listCodeClasses(
  codeClassRepo: Repository<OscuCodeClassOrmEntity>,
  includeInactive = false,
): Promise<OscuCodeClassOrmEntity[]> {
  return codeClassRepo.find({
    where: includeInactive ? {} : { useYn: 'Y' },
    order: { cdCls: 'ASC' },
  });
}

export interface SearchCodesInput {
  /** Restrict to one code group, e.g. '10' (Unit of Quantity), '17' (Packaging Unit), '04' (Tax Type). */
  cdCls?: string;
  /** Matches cd (prefix) or cdNm (contains), case-insensitive. */
  query?: string;
  /** Defaults to false: only useYn='Y' codes are returned. */
  includeInactive?: boolean;
  limit?: number;
}

export async function searchCodes(
  input: SearchCodesInput,
  codeRepo: Repository<OscuCodeOrmEntity>,
): Promise<OscuCodeOrmEntity[]> {
  const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const query = input.query?.trim();

  const qb = codeRepo
    .createQueryBuilder('c')
    .orderBy('c.cdCls', 'ASC')
    .addOrderBy('c.srtOrd', 'ASC')
    .addOrderBy('c.cd', 'ASC')
    .take(limit);

  if (!input.includeInactive) {
    qb.andWhere('c.useYn = :useYn', { useYn: 'Y' });
  }
  if (input.cdCls) {
    qb.andWhere('c.cdCls = :cdCls', { cdCls: input.cdCls });
  }
  if (query) {
    qb.andWhere('(c.cd LIKE :prefix OR c.cdNm LIKE :contains)', {
      prefix: `${query}%`,
      contains: `%${query}%`,
    });
  }

  return qb.getMany();
}
