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
    selectSalesTransactions: 'selectSalesTransactions',
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
    importedItemConvertedInfo: 'importedItemConvertedInfo',
    initialize: 'initialize',
    itemInfo: 'itemInfo',
    saveItemComposition: 'saveItemComposition',
    getPurchaseTransactionInfo: 'getPurchaseTransactionInfo',
    sendPurchaseTransactionInfo: 'sendPurchaseTransactionInfo',
    selectInvoiceDetail: 'selectInvoiceDetail',
    selectSalesTransactions: 'selectSalesTransactions',
  },
} as const;

export type OscuEndpointKey = keyof typeof OSCU_ENDPOINTS.legacy;

export function resolveOscuPath(
  style: OscuPathStyle,
  key: OscuEndpointKey,
): string {
  return OSCU_ENDPOINTS[style][key];
}
