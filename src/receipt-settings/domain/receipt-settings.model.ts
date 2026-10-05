/**
 * Per-business receipt settings: which parts of the receipt print, and the text
 * the business controls. ONE resolver (`resolveReceiptView`) turns the stored
 * settings into the values both the paper receipt (PDF / dashboard receipt) and
 * the OSCU `sendSalesTransaction` `receipt` block read, so what KRA is sent can
 * never differ from what is printed (KRA rejected go-live with "align the invoice
 * transmission as compared to physical invoice").
 */

/** OSCU spec v2.0 `TrnsSalesSaveWrReceipt` field limits (.docs/OSCU_Specification_Document_v2.0.txt). */
export const RECEIPT_FIELD_LIMITS = {
  tradeName: 20, // trdeNm
  address: 200, // adrs
  headerMessage: 20, // topMsg
  footerMessage: 20, // btmMsg
  customerMobile: 20, // custMblNo
} as const;

export type ReceiptTextKey = 'tradeName' | 'address' | 'headerMessage' | 'footerMessage';

export interface ReceiptSectionDef {
  key: string;
  label: string;
  /** Locked sections are mandatory on a KRA TIS receipt and can never be disabled. */
  locked: boolean;
  /** Why it is locked (shown in the UI). */
  lockedReason?: string;
  /** Text field edited inside this section, if any. */
  textKey?: ReceiptTextKey;
}

/**
 * What receipts printed before settings existed. Used ONLY to render documents that were
 * transmitted before this feature (see `legacyReceiptView`), never for new transmissions.
 */
export const LEGACY_HEADER_MESSAGE = 'Thank you for shopping with us';
export const LEGACY_FOOTER_MESSAGE = 'THANK YOU\nWE LOOK FORWARD TO EARNING YOUR BUSINESS';

/**
 * Locked = required by the TIS template (TIS for OSCU/VSCU v2.0 pages 8/10, section
 * numbers in `.docs/TIS_TEMPLATE_CONFORMANCE_PLAN.md`) or carried in the
 * transmission, so hiding it would make paper and transmission differ. Where the
 * spec's own wording is ambiguous the section is locked rather than guessed
 * (marked "unsure" below).
 */
export const RECEIPT_SECTIONS: readonly ReceiptSectionDef[] = [
  { key: 'logo', label: 'Business logo', locked: false },
  { key: 'kraLogo', label: 'KRA logo mark', locked: true, lockedReason: 'TIS 6.28: the KRA logo prints on every receipt.' },
  { key: 'businessName', label: 'Business name', locked: true, lockedReason: 'The full registered business name heads the TIS sample (page 8). It is never shortened or removed.' },
  { key: 'tradeName', label: 'Trade name (optional, "Trading as")', locked: false, textKey: 'tradeName' },
  { key: 'address', label: 'Address', locked: true, textKey: 'address', lockedReason: 'Shop address is on the TIS sample (page 8) and transmitted as adrs. You can change the text. Locked because the spec wording is unsure.' },
  { key: 'supplierPin', label: 'Supplier PIN', locked: true, lockedReason: 'TIS page 8: the supplier PIN is mandatory.' },
  { key: 'documentTitle', label: 'Document title', locked: true, lockedReason: 'TAX INVOICE / CREDIT NOTE title is mandatory (pages 8 and 10).' },
  { key: 'headerMessage', label: 'Header message', locked: false, textKey: 'headerMessage' },
  { key: 'invoiceNumbers', label: 'Invoice details (numbers and date)', locked: true, lockedReason: 'Invoice number and date are mandatory.' },
  { key: 'buyerBlock', label: 'Buyer details (name, PIN)', locked: true, lockedReason: 'Buyer name and PIN are transmitted to KRA, so they must print.' },
  { key: 'customerPhone', label: 'Buyer phone number', locked: false },
  { key: 'itemCodes', label: 'Item codes next to item names', locked: false },
  { key: 'itemsTable', label: 'Items, amounts and totals', locked: true, lockedReason: 'Line items, amounts, totals and payment are mandatory.' },
  { key: 'taxTable', label: 'Tax category table', locked: true, lockedReason: 'TIS 6.21/6.22: all programmed tax rates print on every receipt.' },
  { key: 'scuInfo', label: 'SCU information', locked: true, lockedReason: 'TIS 6.23: CU ID, CU invoice number, receipt counter, internal data and signature are mandatory.' },
  { key: 'qr', label: 'QR code', locked: true, lockedReason: 'The KRA verification QR code is mandatory.' },
  { key: 'tisInfo', label: 'TIS information', locked: true, lockedReason: 'TIS 6.23 names it an optional category, but it is on both KRA samples. Locked because the spec wording is unsure.' },
  { key: 'footerMessage', label: 'Footer message', locked: false, textKey: 'footerMessage' },
] as const;

const SECTION_BY_KEY = new Map(RECEIPT_SECTIONS.map((s) => [s.key, s]));
export const LOCKED_SECTION_KEYS: readonly string[] = RECEIPT_SECTIONS.filter((s) => s.locked).map((s) => s.key);

/** What a section does when the business has never configured it. */
const DEFAULT_ENABLED: Record<string, boolean> = {
  logo: false, // no logo until one is uploaded and switched on
  tradeName: true,
  headerMessage: true,
  customerPhone: true, // the receipt already printed "Tel:" when a phone existed
  itemCodes: false, // today's receipt does not print item codes
  footerMessage: true,
};

export interface ReceiptSettingsData {
  /** Only non-locked section keys ever appear with enabled:false; locked ones are always on. */
  sections: Record<string, { enabled: boolean }>;
  /** tradeName/headerMessage/footerMessage are optional and never defaulted; address overrides the connection address. */
  texts: Partial<Record<ReceiptTextKey, string | null>>;
}

export const EMPTY_RECEIPT_SETTINGS: ReceiptSettingsData = { sections: {}, texts: {} };

export class ReceiptSettingsValidationError extends Error {}

/**
 * Collapses control characters/newlines/runs of whitespace to single spaces. The OSCU
 * fields are single-line CHAR, so the paper uses the same single-line form.
 */
export function normaliseReceiptText(value: string | null | undefined): string | null {
  if (value == null) return null;
  // eslint-disable-next-line no-control-regex
  const cleaned = String(value).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * The single truncation rule used for paper AND transmission. Hard cut at `max`;
 * if that lands mid-word and a space exists, back off to the previous word so
 * the line never ends in a broken word.
 */
export function truncateReceiptText(value: string | null, max: number): string | null {
  if (value == null) return null;
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const midWord = value[max] !== ' ';
  const lastSpace = cut.lastIndexOf(' ');
  const out = midWord && lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
  return out.trim() || cut.trim();
}

function fitted(value: string | null | undefined, max: number): string | null {
  return truncateReceiptText(normaliseReceiptText(value), max);
}

/** Like fitted() but NEVER shortens: a value over the limit is ignored (null), so nothing is silently cut. */
function exact(value: string | null | undefined, max: number): string | null {
  const n = normaliseReceiptText(value);
  return n && n.length <= max ? n : null;
}

/** Validates + canonicalises a PUT body. Throws ReceiptSettingsValidationError (-> 400). */
export function validateReceiptSettingsInput(input: unknown): ReceiptSettingsData {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    throw new ReceiptSettingsValidationError('Body must be an object with "sections" and/or "texts".');
  }
  const raw = input as { sections?: unknown; texts?: unknown };
  const sections: ReceiptSettingsData['sections'] = {};
  if (raw.sections != null) {
    if (typeof raw.sections !== 'object' || Array.isArray(raw.sections)) {
      throw new ReceiptSettingsValidationError('"sections" must be an object keyed by section.');
    }
    for (const [key, value] of Object.entries(raw.sections as Record<string, unknown>)) {
      const def = SECTION_BY_KEY.get(key);
      if (!def) throw new ReceiptSettingsValidationError(`Unknown receipt section "${key}".`);
      const enabled = (value as { enabled?: unknown } | null)?.enabled;
      if (typeof enabled !== 'boolean') {
        throw new ReceiptSettingsValidationError(`Section "${key}" needs { "enabled": true|false }.`);
      }
      if (def.locked) {
        if (!enabled) {
          throw new ReceiptSettingsValidationError(
            `Section "${key}" is mandatory on a KRA receipt and cannot be disabled.`,
          );
        }
        continue; // locked + enabled:true is a no-op, never stored
      }
      sections[key] = { enabled };
    }
  }
  const texts: ReceiptSettingsData['texts'] = {};
  if (raw.texts != null) {
    if (typeof raw.texts !== 'object' || Array.isArray(raw.texts)) {
      throw new ReceiptSettingsValidationError('"texts" must be an object.');
    }
    for (const [key, value] of Object.entries(raw.texts as Record<string, unknown>)) {
      if (!(key in RECEIPT_FIELD_LIMITS) || key === 'customerMobile') {
        throw new ReceiptSettingsValidationError(`Unknown receipt text "${key}".`);
      }
      if (value != null && typeof value !== 'string') {
        throw new ReceiptSettingsValidationError(`Text "${key}" must be a string or null.`);
      }
      const normalised = normaliseReceiptText(value as string | null);
      const max = RECEIPT_FIELD_LIMITS[key as ReceiptTextKey];
      if (normalised && normalised.length > max) {
        throw new ReceiptSettingsValidationError(
          `Text "${key}" is ${normalised.length} characters; KRA allows at most ${max} on a receipt.`,
        );
      }
      texts[key as ReceiptTextKey] = normalised;
    }
  }
  return { sections, texts };
}

export function isSectionEnabled(settings: ReceiptSettingsData | null | undefined, key: string): boolean {
  const def = SECTION_BY_KEY.get(key);
  if (def?.locked) return true;
  return settings?.sections?.[key]?.enabled ?? DEFAULT_ENABLED[key] ?? true;
}

export interface ReceiptViewInput {
  settings: ReceiptSettingsData | null | undefined;
  /** The registered business name (tenant display name): printed in FULL, never transmitted as trdeNm. */
  supplierName: string | null | undefined;
  connection: {
    tradeAddressLine1?: string | null;
    tradeCity?: string | null;
    receiptHeaderMessage?: string | null;
    receiptFooterMessage?: string | null;
  } | null | undefined;
  customerPhone: string | null | undefined;
  /** True when the business has uploaded a logo (the bytes are fetched separately). */
  hasLogo?: boolean;
}

/**
 * Everything the receipt layouts and the OSCU `receipt` block need. Every text except
 * `legalName` is the exact string printed AND transmitted; null means "nothing printed AND
 * null transmitted". Nothing here is silently shortened except the address (200) and phone (20).
 */
export interface ResolvedReceiptView {
  text: {
    /** Registered business name, printed in full on paper. NOT transmitted. */
    legalName: string | null;
    /** OSCU trdeNm -- optional "Trading as" name (<=20); printed on paper when set. */
    tradeName: string | null;
    /** OSCU adrs */
    address: string | null;
    /** OSCU topMsg (<=20) */
    headerMessage: string | null;
    /** OSCU btmMsg (<=20) */
    footerMessage: string | null;
    /** OSCU custMblNo */
    customerMobile: string | null;
  };
  show: {
    logo: boolean;
    itemCodes: boolean;
    customerPhone: boolean;
  };
}

/** A legacy connection/tenant message is only a usable starting value when it fits KRA's limit. */
export function legacyMessageNotices(connection: ReceiptViewInput['connection']): string[] {
  const notices: string[] = [];
  const h = normaliseReceiptText(connection?.receiptHeaderMessage);
  const f = normaliseReceiptText(connection?.receiptFooterMessage);
  if (h && h.length > RECEIPT_FIELD_LIMITS.headerMessage) {
    notices.push(`Your previous header message is longer than KRA allows (${RECEIPT_FIELD_LIMITS.headerMessage} characters); choose a shorter one.`);
  }
  if (f && f.length > RECEIPT_FIELD_LIMITS.footerMessage) {
    notices.push(`Your previous footer message is longer than KRA allows (${RECEIPT_FIELD_LIMITS.footerMessage} characters); choose a shorter one.`);
  }
  return notices;
}

export function resolveReceiptView(input: ReceiptViewInput): ResolvedReceiptView {
  const { settings, connection } = input;
  const t = settings?.texts ?? {};
  const legacyAddress = [connection?.tradeAddressLine1, connection?.tradeCity].filter(Boolean).join(', ');

  const tradeOn = isSectionEnabled(settings, 'tradeName');
  const headerOn = isSectionEnabled(settings, 'headerMessage');
  const footerOn = isSectionEnabled(settings, 'footerMessage');
  const phoneOn = isSectionEnabled(settings, 'customerPhone');

  return {
    text: {
      legalName: normaliseReceiptText(input.supplierName),
      tradeName: tradeOn ? exact(t.tradeName, RECEIPT_FIELD_LIMITS.tradeName) : null,
      address: fitted(t.address || legacyAddress, RECEIPT_FIELD_LIMITS.address),
      // Unset -> nothing. A legacy connection message is a starting value only when it already fits.
      headerMessage: headerOn
        ? exact(t.headerMessage || connection?.receiptHeaderMessage, RECEIPT_FIELD_LIMITS.headerMessage)
        : null,
      footerMessage: footerOn
        ? exact(t.footerMessage || connection?.receiptFooterMessage, RECEIPT_FIELD_LIMITS.footerMessage)
        : null,
      customerMobile: phoneOn ? fitted(input.customerPhone, RECEIPT_FIELD_LIMITS.customerMobile) : null,
    },
    show: {
      logo: isSectionEnabled(settings, 'logo') && input.hasLogo === true,
      itemCodes: isSectionEnabled(settings, 'itemCodes'),
      customerPhone: phoneOn,
    },
  };
}

/**
 * The receipt as it printed BEFORE settings existed, for a document that was already
 * transmitted without a snapshot: full name, the connection's messages (or the old generic
 * defaults) untruncated, no trade name. Never retro-fitted to the new rules.
 */
export function legacyReceiptView(base: ResolvedReceiptView, input: ReceiptViewInput): ResolvedReceiptView {
  const legacyAddress = [input.connection?.tradeAddressLine1, input.connection?.tradeCity].filter(Boolean).join(', ');
  return {
    ...base,
    text: {
      legalName: normaliseReceiptText(input.supplierName),
      tradeName: null,
      address: legacyAddress || null,
      headerMessage: input.connection?.receiptHeaderMessage || LEGACY_HEADER_MESSAGE,
      footerMessage: input.connection?.receiptFooterMessage || LEGACY_FOOTER_MESSAGE,
      customerMobile: input.customerPhone || null,
    },
  };
}

/** The transmitted `receipt` text fields, taken from the same resolved view the paper uses. */
export function receiptBlockTextFromView(view: ResolvedReceiptView): {
  trdeNm: string | null;
  adrs: string | null;
  topMsg: string | null;
  btmMsg: string | null;
  custMblNo: string | null;
} {
  return {
    trdeNm: view.text.tradeName,
    adrs: view.text.address,
    topMsg: view.text.headerMessage,
    btmMsg: view.text.footerMessage,
    custMblNo: view.text.customerMobile,
  };
}

/**
 * For a document that has already been submitted: the paper prints exactly what was
 * transmitted (`ComplianceDocument.receiptTextSnapshot`), whatever the settings say now.
 */
export function applyTransmittedSnapshot(
  view: ResolvedReceiptView,
  snapshot: ReturnType<typeof receiptBlockTextFromView> | null | undefined,
): ResolvedReceiptView {
  if (!snapshot) return view;
  return {
    ...view,
    text: {
      legalName: view.text.legalName,
      tradeName: snapshot.trdeNm,
      address: snapshot.adrs,
      headerMessage: snapshot.topMsg,
      footerMessage: snapshot.btmMsg,
      customerMobile: snapshot.custMblNo,
    },
  };
}
