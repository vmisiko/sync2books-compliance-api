import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import {
  MainApiConnectionApplicationService,
  SUPPORTED_INTEGRATION_KEYS,
  type SupportedIntegrationKey,
} from '../../integration/main-api-pull/application/main-api-connection.application.service';
import {
  MainApiPullClient,
  type MainApiBillMappingOptions,
} from '../../integration/main-api-pull/infrastructure/http/main-api-pull.client';
import { PurchaseBillMappingOrmEntity } from '../infrastructure/persistence/purchase-bill-mapping.orm-entity';
import type { TaxLetter } from './purchase-kra-confirmation.builder';

export const KRA_TAX_TYPES: ReadonlyArray<{ taxTyCd: TaxLetter; label: string }> = [
  { taxTyCd: 'A', label: 'A — Exempt' },
  { taxTyCd: 'B', label: 'B — 16% VAT' },
  { taxTyCd: 'C', label: 'C — 0% (zero-rated)' },
  { taxTyCd: 'D', label: 'D — Non-VAT' },
  { taxTyCd: 'E', label: 'E — 8% VAT' },
];

export type ErpRef = { erpId: string; erpName: string };

/** The mapping `syncToErp()` applies, for the ERP currently connected. */
export type ResolvedPurchaseBillMapping = {
  integrationKey: SupportedIntegrationKey;
  connectionId: string;
  mainApiApiKey: string;
  expenseAccount: ErpRef | null;
  taxes: Partial<Record<TaxLetter, ErpRef>>;
};

export type PurchaseBillMappingView = {
  integrationKey: SupportedIntegrationKey | null;
  connected: boolean;
  kraTaxTypes: typeof KRA_TAX_TYPES;
  options: MainApiBillMappingOptions | null;
  mapping: {
    expenseAccount: ErpRef | null;
    taxes: Partial<Record<TaxLetter, ErpRef>>;
  };
  /** Best-guess ERP tax per KRA type (by name), for unmapped types only — never saved until a user saves. */
  suggestedTaxes: Partial<Record<TaxLetter, string>>;
};

export type SavePurchaseBillMappingInput = {
  expenseAccountId?: string | null;
  taxes?: Partial<Record<string, string | null>>;
};

/** Name heuristics for suggestedTaxes — first match wins, purchase-usable taxes only. */
const TAX_NAME_HINTS: Record<TaxLetter, RegExp[]> = {
  A: [/exempt/i],
  B: [/\b16(\.0+)?\s*%/i, /\b16\b/],
  C: [/zero/i, /\b0(\.0+)?\s*%\s*z/i, /\b0(\.0+)?\s*%/i],
  D: [/no\s*vat/i, /non[-\s]*vat/i, /out of scope/i],
  E: [/\b8(\.0+)?\s*%/i, /\b8\b/],
};

@Injectable()
export class PurchaseBillMappingService {
  constructor(
    @InjectRepository(PurchaseBillMappingOrmEntity)
    private readonly repo: Repository<PurchaseBillMappingOrmEntity>,
    private readonly mainApiConnections: MainApiConnectionApplicationService,
    private readonly mainApiPull: MainApiPullClient,
  ) {}

  /** Mapping + live ERP options for the Mapping Center's Purchase Bills tab. */
  async get(complianceTenantId: string): Promise<PurchaseBillMappingView> {
    const merchantId =
      await this.mainApiConnections.resolveMerchantId(complianceTenantId);
    const connection = await this.resolveConnection(complianceTenantId);
    if (!connection) {
      return {
        integrationKey: null,
        connected: false,
        kraTaxTypes: KRA_TAX_TYPES,
        options: null,
        mapping: { expenseAccount: null, taxes: {} },
        suggestedTaxes: {},
      };
    }

    const [options, mapping] = await Promise.all([
      this.mainApiPull.getBillMappingOptions(
        connection.mainApiApiKey,
        connection.connectionId,
      ),
      this.readMapping(merchantId, connection.integrationKey),
    ]);

    const suggestedTaxes: Partial<Record<TaxLetter, string>> = {};
    const purchaseTaxes = options.taxes.filter((t) => t.usableForPurchases);
    for (const { taxTyCd } of KRA_TAX_TYPES) {
      if (mapping.taxes[taxTyCd]) continue;
      const hit = TAX_NAME_HINTS[taxTyCd]
        .map((re) =>
          purchaseTaxes.find((t) => re.test(`${t.name} ${t.description ?? ''}`)),
        )
        .find(Boolean);
      if (hit) suggestedTaxes[taxTyCd] = hit.id;
    }

    return {
      integrationKey: connection.integrationKey,
      connected: true,
      kraTaxTypes: KRA_TAX_TYPES,
      options,
      mapping,
      suggestedTaxes,
    };
  }

  /**
   * Replaces the mapping for the connected ERP. Every id is checked against
   * the ERP's live options (and names taken from there), so a stale or
   * hand-crafted id can't be saved and later sent on a Bill. A null clears
   * that row.
   */
  async save(
    complianceTenantId: string,
    input: SavePurchaseBillMappingInput,
    userEmail: string | null,
  ): Promise<PurchaseBillMappingView> {
    const merchantId =
      await this.mainApiConnections.resolveMerchantId(complianceTenantId);
    const connection = await this.resolveConnection(complianceTenantId);
    if (!connection) {
      throw new BadRequestException(
        'No connected accounting system for this tenant yet — connect QuickBooks or Odoo first.',
      );
    }
    const options = await this.mainApiPull.getBillMappingOptions(
      connection.mainApiApiKey,
      connection.connectionId,
    );

    if (input.expenseAccountId !== undefined) {
      if (input.expenseAccountId === null) {
        await this.repo.delete({
          merchantId,
          integrationKey: connection.integrationKey,
          kind: 'expense_account',
        });
      } else {
        const account = options.accounts.find(
          (a) => a.id === input.expenseAccountId,
        );
        if (!account) {
          throw new BadRequestException(
            `Account ${input.expenseAccountId} was not found in your accounting system.`,
          );
        }
        await this.upsert(merchantId, connection.integrationKey, 'expense_account', '', {
          erpId: account.id,
          erpName: account.name,
          updatedBy: userEmail,
        });
      }
    }

    for (const [letter, taxId] of Object.entries(input.taxes ?? {})) {
      if (!KRA_TAX_TYPES.some((t) => t.taxTyCd === letter)) {
        throw new BadRequestException(`Unknown KRA tax type "${letter}".`);
      }
      if (taxId === undefined) continue;
      if (taxId === null) {
        await this.repo.delete({
          merchantId,
          integrationKey: connection.integrationKey,
          kind: 'tax',
          taxTyCd: letter,
        });
        continue;
      }
      const tax = options.taxes.find((t) => t.id === taxId);
      if (!tax) {
        throw new BadRequestException(
          `Tax ${taxId} was not found in your accounting system.`,
        );
      }
      if (!tax.usableForPurchases) {
        throw new BadRequestException(
          `"${tax.name}" is a sales-only tax in your accounting system and can't be applied to a purchase bill.`,
        );
      }
      await this.upsert(merchantId, connection.integrationKey, 'tax', letter, {
        erpId: tax.id,
        erpName: tax.name,
        updatedBy: userEmail,
      });
    }

    return this.get(complianceTenantId);
  }

  /**
   * Turns an account id chosen at sync time into the ERP's own name for it,
   * refusing one the connected ERP does not have. Same rule as saving the
   * default: ids and names come from the ERP's live list, never from the caller.
   */
  async resolveAccountOverride(
    mapping: Pick<ResolvedPurchaseBillMapping, 'connectionId' | 'mainApiApiKey'>,
    accountId: string,
  ): Promise<ErpRef> {
    const options = await this.mainApiPull.getBillMappingOptions(
      mapping.mainApiApiKey,
      mapping.connectionId,
    );
    const account = options.accounts.find((a) => a.id === accountId);
    if (!account) {
      throw new BadRequestException(
        `Account ${accountId} was not found in your accounting system.`,
      );
    }
    return { erpId: account.id, erpName: account.name };
  }

  /** What syncToErp() applies — null when no supported ERP is connected. */
  async resolveForSync(
    complianceTenantId: string,
    merchantId: string,
  ): Promise<ResolvedPurchaseBillMapping | null> {
    const connection = await this.resolveConnection(complianceTenantId);
    if (!connection) return null;
    const mapping = await this.readMapping(merchantId, connection.integrationKey);
    return { ...connection, ...mapping };
  }

  private async resolveConnection(complianceTenantId: string): Promise<{
    integrationKey: SupportedIntegrationKey;
    connectionId: string;
    mainApiApiKey: string;
  } | null> {
    const connection =
      await this.mainApiConnections.getForTenant(complianceTenantId);
    const integrationKey = SUPPORTED_INTEGRATION_KEYS.find(
      (key) => connection.integrations[key]?.connectionId,
    );
    const connectionId = integrationKey
      ? connection.integrations[integrationKey]?.connectionId
      : null;
    if (!integrationKey || !connectionId) return null;
    return {
      integrationKey,
      connectionId,
      mainApiApiKey: connection.mainApiApiKey,
    };
  }

  private async readMapping(merchantId: string, integrationKey: string) {
    const rows = await this.repo.find({ where: { merchantId, integrationKey } });
    const account = rows.find((r) => r.kind === 'expense_account');
    const taxes: Partial<Record<TaxLetter, ErpRef>> = {};
    for (const row of rows) {
      if (row.kind === 'tax') {
        taxes[row.taxTyCd as TaxLetter] = { erpId: row.erpId, erpName: row.erpName };
      }
    }
    return {
      expenseAccount: account
        ? { erpId: account.erpId, erpName: account.erpName }
        : null,
      taxes,
    };
  }

  private async upsert(
    merchantId: string,
    integrationKey: string,
    kind: PurchaseBillMappingOrmEntity['kind'],
    taxTyCd: string,
    values: Pick<PurchaseBillMappingOrmEntity, 'erpId' | 'erpName' | 'updatedBy'>,
  ): Promise<void> {
    const existing = await this.repo.findOne({
      where: { merchantId, integrationKey, kind, taxTyCd },
    });
    await this.repo.save(
      existing
        ? Object.assign(existing, values)
        : this.repo.create({ merchantId, integrationKey, kind, taxTyCd, ...values }),
    );
  }
}
