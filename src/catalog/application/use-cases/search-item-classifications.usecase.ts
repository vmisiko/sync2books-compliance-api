import type { Repository } from 'typeorm';
import { OscuItemClassificationOrmEntity } from '../../../regulatory/oscu/infrastructure/persistence/oscu-item-classification.orm-entity';

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

export interface SearchItemClassificationsInput {
  /** Matches itemClsCd (prefix) or itemClsNm (contains), case-insensitive. */
  query?: string;
  itemClsLvl?: number;
  /** Defaults to false: only useYn='Y' codes are returned. */
  includeInactive?: boolean;
  limit?: number;
}

export async function searchItemClassifications(
  input: SearchItemClassificationsInput,
  classificationRepo: Repository<OscuItemClassificationOrmEntity>,
): Promise<OscuItemClassificationOrmEntity[]> {
  const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const query = input.query?.trim();

  // Sorted by name, not code: an unsearched open (no query) shows this list
  // as-is, and KRA's itemClsCd is assigned in taxonomy-import order, not a
  // meaningful browse order — code-ascending put "Live Plant and Animal
  // Material..." first for every merchant regardless of what they sell.
  // Name-ascending at least gives a recognizable, alphabetically scannable
  // list to scroll through when a user doesn't know what to search for.
  const qb = classificationRepo
    .createQueryBuilder('c')
    .orderBy('c.itemClsNm', 'ASC')
    .take(limit);

  if (!input.includeInactive) {
    qb.andWhere('c.useYn = :useYn', { useYn: 'Y' });
  }
  if (typeof input.itemClsLvl === 'number') {
    qb.andWhere('c.itemClsLvl = :lvl', { lvl: input.itemClsLvl });
  }
  if (query) {
    qb.andWhere('(c.itemClsCd LIKE :prefix OR c.itemClsNm LIKE :contains)', {
      prefix: `${query}%`,
      contains: `%${query}%`,
    });
  }

  return qb.getMany();
}
