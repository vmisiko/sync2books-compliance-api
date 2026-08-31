/**
 * OSCU HTTP path names — two deployment styles seen in the wild:
 *
 * - **legacy** — direct eTIMS API host + flat paths from OSCU Specification v2.0.
 * - **integrator** — Apigee “eTIMS-OSCU” Postman collection (`etims-oscu/api/v1`).
 *
 * Most resource names are identical across styles; differences are noted in the integrator column.
 */
export type OscuPathStyle = 'legacy' | 'integrator';

export const OSCU_ENDPOINTS = {
  legacy: {
    submitSales: 'saveTrnsSalesOsdc',
    saveItem: 'saveItem',
    insertStockIO: 'insertStockIO',
    saveStockMaster: 'saveStockMaster',
    selectStockMoveList: 'selectStockMoveList',
    branchInsuranceInfo: 'branchInsuranceInfo',
    branchUserAccount: 'branchUserAccount',
    branchSendCustomerInfo: 'branchSendCustomerInfo',
    branchList: 'branchList',
    selectCodeList: 'selectCodeList',
    customerPinInfo: 'customerPinInfo',
    // Legacy/direct-KRA-host path per OSCU Specification v2.0 §3.3.3.1.
    selectItemClsList: 'selectItemClsList',
    selectTaxpayerInfo: 'selectTaxpayerInfo',
    selectNoticeList: 'selectNoticeList',
    importedItemInfo: 'importedItemInfo',
    importedItemConvertedInfo: 'importedItemConvertedInfo',
    initialize: 'initialize',
    itemInfo: 'itemInfo',
    saveItemComposition: 'saveItemComposition',
    getPurchaseTransactionInfo: 'getPurchaseTransactionInfo',
    sendPurchaseTransactionInfo: 'sendPurchaseTransactionInfo',
    selectInvoiceDetail: 'selectInvoiceDetail',
    // Not `/selectSalesTransactions` -- that string was never confirmed against
    // real KRA/Apigee and isn't documented anywhere in the OSCU v2.0 spec.
    // `/selectTrnsSalesList` is the one KRA Go-Live actually tested and passed
    // (test #21 "LOOK UP TRANSACTION SALES LIST", resultCd 000 -- see
    // .docs/go-live-evidence/README.md).
    selectSalesTransactions: 'selectTrnsSalesList',
    selectCustomerList: 'selectCustomerList',
  },
  integrator: {
    submitSales: 'sendSalesTransaction',
    saveItem: 'saveItem',
    insertStockIO: 'insert/stockIO',
    saveStockMaster: 'save/stockMaster',
    selectStockMoveList: 'selectStockMoveLists',
    branchInsuranceInfo: 'branchInsuranceInfo',
    branchUserAccount: 'branchUserAccount',
    branchSendCustomerInfo: 'branchSendCustomerInfo',
    branchList: 'branchList',
    selectCodeList: 'selectCodeList',
    customerPinInfo: 'customerPinInfo',
    // Verified against the real "eTIMS-OSCU-Integrator-Automated-Testing-SBX" Postman
    // collection (Gava Connect dev portal): the Apigee integrator gateway exposes this
    // as `/selectItemClass` (no "List" suffix) -- diverges from the legacy spec path.
    selectItemClsList: 'selectItemClass',
    selectTaxpayerInfo: 'selectTaxpayerInfo',
    selectNoticeList: 'selectNoticeList',
    importedItemInfo: 'importedItemInfo',
    // The KRA Go-Live dashboard's "Update Imported Items" test case tracks calls to the
    // literal path `/updateImportItem`, not `/importedItemConvertedInfo` -- confirmed live
    // 2026-08-12 via raw curl: both paths return identical, specific validation errors for
    // the same bad input (e.g. "taskCd 'N' not found."), meaning they're either aliases of
    // the same backend handler or share validation logic. Our own client had only ever
    // called `importedItemConvertedInfo`, so the dashboard never saw a matching call and
    // showed this test case as failed/not-executed regardless of how many times our calls
    // to the other path succeeded. Switched to the path the dashboard actually watches.
    importedItemConvertedInfo: 'updateImportItem',
    initialize: 'initialize',
    itemInfo: 'itemInfo',
    saveItemComposition: 'saveItemComposition',
    getPurchaseTransactionInfo: 'getPurchaseTransactionInfo',
    sendPurchaseTransactionInfo: 'sendPurchaseTransactionInfo',
    selectInvoiceDetail: 'selectInvoiceDetail',
    // Same correction as the legacy entry above -- see its comment.
    selectSalesTransactions: 'selectTrnsSalesList',
    // Confirmed live 2026-08-11 against the Apigee integrator gateway: same name as
    // legacy, resultCd 000 with a real custList.
    selectCustomerList: 'selectCustomerList',
  },
} as const;

export type OscuEndpointKey = keyof typeof OSCU_ENDPOINTS.legacy;

export function resolveOscuPath(
  style: OscuPathStyle,
  key: OscuEndpointKey,
): string {
  return OSCU_ENDPOINTS[style][key];
}
