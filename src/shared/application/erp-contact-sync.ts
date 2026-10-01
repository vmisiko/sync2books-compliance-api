import { SourceSystem } from '../domain/enums/source-system.enum';

/**
 * The SourceSystem value a contact pushed to (or adopted from) an ERP is
 * tagged with — the same value a pull writes via `standardized.sourceSystem`,
 * so a pushed row and a pulled row for the same vendor/customer are
 * indistinguishable. A plain `toUpperCase()` is wrong for Business Central:
 * its integration key is hyphenated, the enum value is underscored.
 */
export function sourceSystemForIntegrationKey(integrationKey: string): string {
  const value = integrationKey.toUpperCase().replace(/-/g, '_');
  return (Object.values(SourceSystem) as string[]).includes(value)
    ? value
    : integrationKey.toUpperCase();
}

/** One row of a bulk "Sync to ERP" on the Suppliers/Customers page. */
export type ContactErpSyncResult = {
  id: string;
  name: string;
  /** linked = exists in the ERP now (`created` says whether it was new or adopted). */
  status: 'linked' | 'failed' | 'skipped';
  created?: boolean;
  message?: string;
};

export const normalizePin = (value: string | null | undefined) =>
  (value ?? '').trim().toUpperCase();

export const normalizeName = (value: string | null | undefined) =>
  (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * What happened in the ERP when a dashboard edit to a supplier/customer was
 * passed on. `updated` = the ERP record now has the new details; `skipped` =
 * nothing to update there (not in the ERP yet, or no ERP connected); `failed`
 * = saved here, but the ERP still has the old details.
 */
export type ContactErpUpdateResult = {
  status: 'updated' | 'skipped' | 'failed';
  message?: string;
};

/** The main API's `erpSync` verdict, in the dashboard's terms. */
export function toContactErpUpdateResult(
  erpSync:
    | {
        status: 'synced' | 'skipped' | 'failed';
        reason?: string;
        error?: string;
      }
    | undefined,
): ContactErpUpdateResult {
  if (!erpSync) return { status: 'updated' };
  if (erpSync.status === 'synced') return { status: 'updated' };
  if (erpSync.status === 'failed') {
    return { status: 'failed', message: erpSync.error };
  }
  return { status: 'skipped', message: erpSync.reason };
}
