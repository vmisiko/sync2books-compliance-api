import type {
  EtimsConnectionContext,
  EtimsSubmissionResult,
  IEtimsAdapter,
} from '../ports/etims-adapter.port';
import type { OscuEnvelopeResponse } from '../transport/oscu-envelope-result';
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

function stubOscuEnvelope(): OscuEnvelopeResponse {
  const now = new Date();
  return {
    success: true,
    rawResponse: {
      resultCd: '000',
      resultMsg: 'It is succeeded',
      resultDt: formatYyyyMMddhhmmssUtc(now),
      data: null,
    },
  };
}

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
    connectionContext: EtimsConnectionContext,
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
    _connectionContext: EtimsConnectionContext,
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
    _connectionContext: EtimsConnectionContext,
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
    _connectionContext: EtimsConnectionContext,
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
    _connectionContext: EtimsConnectionContext,
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

  branchInsuranceInfo(
    _body: Record<string, unknown>,
    _ctx: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse> {
    void _body;
    void _ctx;
    return Promise.resolve(stubOscuEnvelope());
  }

  branchUserAccount(
    _body: Record<string, unknown>,
    _ctx: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse> {
    void _body;
    void _ctx;
    return Promise.resolve(stubOscuEnvelope());
  }

  branchSendCustomerInfo(
    _body: Record<string, unknown>,
    _ctx: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse> {
    void _body;
    void _ctx;
    return Promise.resolve(stubOscuEnvelope());
  }

  branchList(
    _body: Record<string, unknown>,
    _ctx: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse> {
    void _body;
    void _ctx;
    return Promise.resolve(stubOscuEnvelope());
  }

  selectCodeList(
    _body: Record<string, unknown>,
    _ctx: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse> {
    void _body;
    void _ctx;
    return Promise.resolve(stubOscuEnvelope());
  }

  customerPinInfo(
    _body: Record<string, unknown>,
    _ctx: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse> {
    void _body;
    void _ctx;
    return Promise.resolve(stubOscuEnvelope());
  }

  selectItemClass(
    _body: Record<string, unknown>,
    _ctx: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse> {
    void _body;
    void _ctx;
    return Promise.resolve(stubOscuEnvelope());
  }

  selectTaxpayerInfo(
    _body: Record<string, unknown>,
    _ctx: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse> {
    void _body;
    void _ctx;
    return Promise.resolve(stubOscuEnvelope());
  }

  selectNoticeList(
    _body: Record<string, unknown>,
    _ctx: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse> {
    void _body;
    void _ctx;
    return Promise.resolve(stubOscuEnvelope());
  }

  importedItemInfo(
    _body: Record<string, unknown>,
    _ctx: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse> {
    void _body;
    void _ctx;
    return Promise.resolve(stubOscuEnvelope());
  }

  importedItemConvertedInfo(
    _body: Record<string, unknown>,
    _ctx: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse> {
    void _body;
    void _ctx;
    return Promise.resolve(stubOscuEnvelope());
  }

  initializeOscu(
    body: Record<string, unknown>,
    _ctx: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse> {
    void _ctx;
    const now = new Date();
    const resultDt = formatYyyyMMddhhmmssUtc(now);
    const tin = typeof body.tin === 'string' ? body.tin : '';
    const bhfId = typeof body.bhfId === 'string' ? body.bhfId : '';
    const dvcSrlNo =
      typeof body.dvcSrlNo === 'string' ? body.dvcSrlNo : '';
    return Promise.resolve({
      success: true,
      rawResponse: {
        resultCd: '000',
        resultMsg: 'It is succeeded',
        resultDt,
        data: {
          info: {
            tin,
            bhfId,
            dvcSrlNo,
            dvcId: `stub-dvc-${resultDt}`,
            cmcKey: 'cmc-key-stub-init',
            taxprNm: 'Stub Taxpayer',
            bsnsActv: '',
            bhfNm: 'Stub Branch',
            bhfOpenDt: '',
            prvncNm: '',
            dstrtNm: '',
            sctrNm: '',
            locDesc: '',
            hqYn: 'Y',
            mgrNm: '',
            mgrTelNo: '',
            mgrEmail: '',
            sdcId: 'stub-sdc',
            mrcNo: '',
          },
        },
      },
    });
  }

  getItemInfo(
    _body: Record<string, unknown>,
    _ctx: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse> {
    void _body;
    void _ctx;
    return Promise.resolve(stubOscuEnvelope());
  }

  saveItemComposition(
    _body: Record<string, unknown>,
    _ctx: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse> {
    void _body;
    void _ctx;
    return Promise.resolve(stubOscuEnvelope());
  }

  getPurchaseTransactionInfo(
    _body: Record<string, unknown>,
    _ctx: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse> {
    void _body;
    void _ctx;
    return Promise.resolve(stubOscuEnvelope());
  }

  sendPurchaseTransactionInfo(
    _body: Record<string, unknown>,
    _ctx: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse> {
    void _body;
    void _ctx;
    return Promise.resolve(stubOscuEnvelope());
  }

  selectInvoiceDetail(
    _body: Record<string, unknown>,
    _ctx: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse> {
    void _body;
    void _ctx;
    return Promise.resolve(stubOscuEnvelope());
  }

  selectSalesTransactions(
    _body: Record<string, unknown>,
    _ctx: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse> {
    void _body;
    void _ctx;
    return Promise.resolve(stubOscuEnvelope());
  }
}
