import type {
  EtimsSubmissionResult,
  IEtimsAdapter,
} from '../ports/etims-adapter.port';
import type { EtimsInvoicePayload } from '../mapping/etims-payload.types';
import { OscuSalesRequestBuilder } from '../mapping/oscu-sales-request.builder';
import type { OscuTrnsSalesSaveWrRes } from '../transport/endpoints/trns-sales-save.dto';
import type {
  OscuStockIOSaveReq,
  OscuStockIOSaveRes,
} from '../transport/endpoints/stock-io-save.dto';
import type {
  OscuStockMasterSaveReq,
  OscuStockMasterSaveRes,
} from '../transport/endpoints/stock-master-save.dto';
import type {
  OscuStockMoveReq,
  OscuStockMoveRes,
} from '../transport/endpoints/stock-move-list.dto';
import type {
  OscuItemSaveReq,
  OscuItemSaveRes,
} from '../transport/endpoints/item-save.dto';

function formatYyyyMMddhhmmssUtc(date: Date): string {
  const pad2 = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}` +
    `${pad2(date.getUTCMonth() + 1)}` +
    `${pad2(date.getUTCDate())}` +
    `${pad2(date.getUTCHours())}` +
    `${pad2(date.getUTCMinutes())}` +
    `${pad2(date.getUTCSeconds())}`
  );
}

/**
 * Stub OSCU/eTIMS adapter - replace with real implementation.
 * Transport-only: auth, signatures, error normalization.
 */
export class EtimsAdapterStub implements IEtimsAdapter {
  submitInvoice(
    payload: EtimsInvoicePayload,
    connectionContext: {
      merchantId: string;
      branchId: string;
      kraPin: string;
      environment: 'SANDBOX' | 'PRODUCTION';
      cmcKey: string;
      deviceId: string;
    },
  ): Promise<EtimsSubmissionResult> {
    const request = OscuSalesRequestBuilder.build({
      payload,
      tin: connectionContext.kraPin,
      bhfId: connectionContext.branchId,
      cmcKey: connectionContext.cmcKey,
    });
    const now = new Date();
    const nowMs = now.getTime();
    const resultDt = formatYyyyMMddhhmmssUtc(now);
    const rawResponse: OscuTrnsSalesSaveWrRes = {
      resultCd: '000',
      resultMsg: 'It is succeeded',
      resultDt,
      data: {
        curRcptNo: String(nowMs),
        totRcptNo: String(nowMs),
        intrlData: 'STUB-INTRL',
        rcptSign: 'STUB-SIGN',
        sdcDateTime: resultDt,
      },
    };
    return Promise.resolve({
      success: true,
      receiptNumber: `ETR-${nowMs}-${payload.documentNumber}`,
      rawResponse: {
        ...rawResponse,
        request,
      },
    });
  }

  insertStockIO(
    _request: OscuStockIOSaveReq,
    _connectionContext: {
      merchantId: string;
      branchId: string;
      kraPin: string;
      environment: 'SANDBOX' | 'PRODUCTION';
      cmcKey: string;
      deviceId: string;
    },
  ): Promise<{
    success: boolean;
    rawResponse?: OscuStockIOSaveRes;
    error?: string;
  }> {
    void _request;
    void _connectionContext;
    const now = new Date();
    const rawResponse: OscuStockIOSaveRes = {
      resultCd: '000',
      resultMsg: 'It is succeeded',
      resultDt: formatYyyyMMddhhmmssUtc(now),
      data: null,
    };
    return Promise.resolve({
      success: true,
      rawResponse,
    });
  }

  saveItem(
    _request: OscuItemSaveReq,
    _connectionContext: {
      merchantId: string;
      branchId: string;
      kraPin: string;
      environment: 'SANDBOX' | 'PRODUCTION';
      cmcKey: string;
      deviceId: string;
    },
  ): Promise<{
    success: boolean;
    rawResponse?: OscuItemSaveRes;
    error?: string;
  }> {
    void _request;
    void _connectionContext;
    const now = new Date();
    const rawResponse: OscuItemSaveRes = {
      resultCd: '000',
      resultMsg: 'It is succeeded',
      resultDt: formatYyyyMMddhhmmssUtc(now),
      data: null,
    };
    return Promise.resolve({
      success: true,
      rawResponse,
    });
  }

  saveStockMaster(
    _request: OscuStockMasterSaveReq,
    _connectionContext: {
      merchantId: string;
      branchId: string;
      kraPin: string;
      environment: 'SANDBOX' | 'PRODUCTION';
      cmcKey: string;
      deviceId: string;
    },
  ): Promise<{
    success: boolean;
    rawResponse?: OscuStockMasterSaveRes;
    error?: string;
  }> {
    void _request;
    void _connectionContext;
    const now = new Date();
    const rawResponse: OscuStockMasterSaveRes = {
      resultCd: '000',
      resultMsg: 'It is succeeded',
      resultDt: formatYyyyMMddhhmmssUtc(now),
      data: null,
    };
    return Promise.resolve({
      success: true,
      rawResponse,
    });
  }

  selectStockMoveList(
    _request: OscuStockMoveReq,
    _connectionContext: {
      merchantId: string;
      branchId: string;
      kraPin: string;
      environment: 'SANDBOX' | 'PRODUCTION';
      cmcKey: string;
      deviceId: string;
    },
  ): Promise<{
    success: boolean;
    rawResponse?: OscuStockMoveRes;
    error?: string;
  }> {
    void _request;
    void _connectionContext;
    const now = new Date();
    const rawResponse: OscuStockMoveRes = {
      resultCd: '000',
      resultMsg: 'It is succeeded',
      resultDt: formatYyyyMMddhhmmssUtc(now),
      data: { stockMoveList: [] },
    };
    return Promise.resolve({
      success: true,
      rawResponse,
    });
  }
}
