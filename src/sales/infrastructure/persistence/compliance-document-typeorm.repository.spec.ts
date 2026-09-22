import { ComplianceDocumentTypeOrmRepository } from './compliance-document-typeorm.repository';

describe('ComplianceDocumentTypeOrmRepository.findPageByMerchantWithLines -- cursor scoping', () => {
  function repoWith(cursorRows: Record<string, unknown>) {
    const qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    const documentRepo = {
      createQueryBuilder: jest.fn(() => qb),
      // Mirrors a real lookup: matches only when every where-key matches.
      findOne: jest.fn(
        async ({ where }: { where: { id: string; merchantId?: string } }) => {
          const row = cursorRows[where.id] as { merchantId: string } | undefined;
          if (!row) return null;
          return where.merchantId === undefined ||
            row.merchantId === where.merchantId
            ? row
            : null;
        },
      ),
    };
    const repo = new ComplianceDocumentTypeOrmRepository(
      documentRepo as never,
      { find: jest.fn() } as never,
    );
    return { repo, qb, documentRepo };
  }

  const cursorRows = {
    'doc-own': {
      id: 'doc-own',
      merchantId: 'company-a',
      createdAt: new Date('2026-09-01T00:00:00Z'),
    },
    'doc-foreign': {
      id: 'doc-foreign',
      merchantId: 'company-b',
      createdAt: new Date('2026-09-20T00:00:00Z'),
    },
  };

  it.each([
    ['beforeId', 'before'],
    ['afterId', 'after'],
  ] as const)(
    'looks the %s cursor up within the merchant',
    async (key, _label) => {
      const { repo, documentRepo } = repoWith(cursorRows);
      await repo.findPageByMerchantWithLines({
        merchantId: 'company-a',
        [key]: 'doc-own',
        take: 21,
      });
      expect(documentRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'doc-own', merchantId: 'company-a' },
      });
    },
  );

  // Otherwise a caller could steer their own listing by another merchant's
  // createdAt -- a small oracle on when someone else's documents were made.
  it.each(['beforeId', 'afterId'] as const)(
    "ignores another merchant's %s cursor instead of filtering by its createdAt",
    async (key) => {
      const { repo, qb } = repoWith(cursorRows);
      await repo.findPageByMerchantWithLines({
        merchantId: 'company-a',
        [key]: 'doc-foreign',
        take: 21,
      });
      // Only the merchant filter: no cursor predicate was added.
      expect(qb.andWhere).not.toHaveBeenCalled();
      expect(qb.where).toHaveBeenCalledWith('doc.merchantId = :merchantId', {
        merchantId: 'company-a',
      });
    },
  );

  it("still applies the merchant's own cursor", async () => {
    const { repo, qb } = repoWith(cursorRows);
    await repo.findPageByMerchantWithLines({
      merchantId: 'company-a',
      beforeId: 'doc-own',
      take: 21,
    });
    expect(qb.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('doc.createdAt <'),
      expect.objectContaining({ cursorId: 'doc-own' }),
    );
  });
});
