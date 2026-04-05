/**
 * Compliance-side tenant (maps 1:1 to a Sync2Books company / business).
 */
export interface ComplianceTenant {
  id: string;
  sync2booksCompanyId: string | null;
  displayName: string | null;
  createdAt: Date;
  updatedAt: Date;
}
