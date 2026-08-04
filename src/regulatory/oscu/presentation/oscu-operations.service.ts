import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { CONNECTION_REPO, ETIMS_ADAPTER } from '../../../shared/tokens';
import type { IComplianceConnectionRepository } from '../../../shared/ports/repository.port';
import type { ComplianceConnection } from '../../../shared/domain/entities/compliance-connection.entity';
import type {
  EtimsConnectionContext,
  IEtimsAdapter,
} from '../ports/etims-adapter.port';
import type { OscuEnvelopeResponse } from '../transport';
import { OscuOperationLogOrmEntity } from '../infrastructure/persistence/oscu-operation-log.orm-entity';

/** KRA's own sample `lastReqDt` for a first-ever pull (OSCU spec §3.3.3.1 JSON SAMPLE). */
const EPOCH_LAST_REQ_DT = '20180523000000';

type EnvelopeOperation =
  | 'branchInsuranceInfo'
  | 'branchUserAccount'
  | 'branchSendCustomerInfo'
  | 'branchList'
  | 'customerPinInfo'
  | 'selectTaxpayerInfo'
  | 'selectNoticeList'
  | 'importedItemInfo'
  | 'importedItemConvertedInfo'
  | 'getItemInfo'
  | 'saveItemComposition'
  | 'getPurchaseTransactionInfo'
  | 'sendPurchaseTransactionInfo'
  | 'selectInvoiceDetail'
  | 'selectSalesTransactions';

type EnvelopeAdapterMethod = (
  body: Record<string, unknown>,
  ctx: EtimsConnectionContext,
) => Promise<OscuEnvelopeResponse>;

@Injectable()
export class OscuOperationsService {
  private readonly envelopeOperations: Record<
    EnvelopeOperation,
    EnvelopeAdapterMethod
  >;

  constructor(
    @Inject(CONNECTION_REPO)
    private readonly connectionRepo: IComplianceConnectionRepository,
    @Inject(ETIMS_ADAPTER)
    private readonly etimsAdapter: IEtimsAdapter,
    @InjectRepository(OscuOperationLogOrmEntity)
    private readonly logRepo: Repository<OscuOperationLogOrmEntity>,
  ) {
    this.envelopeOperations = {
      branchInsuranceInfo: (b, c) =>
        this.etimsAdapter.branchInsuranceInfo(b, c),
      branchUserAccount: (b, c) => this.etimsAdapter.branchUserAccount(b, c),
      branchSendCustomerInfo: (b, c) =>
        this.etimsAdapter.branchSendCustomerInfo(b, c),
      branchList: (b, c) => this.etimsAdapter.branchList(b, c),
      customerPinInfo: (b, c) => this.etimsAdapter.customerPinInfo(b, c),
      selectTaxpayerInfo: (b, c) => this.etimsAdapter.selectTaxpayerInfo(b, c),
      selectNoticeList: (b, c) => this.etimsAdapter.selectNoticeList(b, c),
      importedItemInfo: (b, c) => this.etimsAdapter.importedItemInfo(b, c),
      importedItemConvertedInfo: (b, c) =>
        this.etimsAdapter.importedItemConvertedInfo(b, c),
      getItemInfo: (b, c) => this.etimsAdapter.getItemInfo(b, c),
      saveItemComposition: (b, c) =>
        this.etimsAdapter.saveItemComposition(b, c),
      getPurchaseTransactionInfo: (b, c) =>
        this.etimsAdapter.getPurchaseTransactionInfo(b, c),
      sendPurchaseTransactionInfo: (b, c) =>
        this.etimsAdapter.sendPurchaseTransactionInfo(b, c),
      selectInvoiceDetail: (b, c) =>
        this.etimsAdapter.selectInvoiceDetail(b, c),
      selectSalesTransactions: (b, c) =>
        this.etimsAdapter.selectSalesTransactions(b, c),
    };
  }

  private async resolveContext(
    merchantId: string,
    branchId: string,
  ): Promise<{
    connection: ComplianceConnection;
    ctx: EtimsConnectionContext;
  }> {
    const connection = await this.connectionRepo.findByMerchantAndBranch(
      merchantId,
      branchId,
    );
    if (!connection) {
      throw new NotFoundException(
        `No active eTIMS connection for merchant=${merchantId} branch=${branchId}`,
      );
    }
    if (!connection.kraBhfId) {
      throw new BadRequestException(
        `Branch ${branchId} has no KRA branch office id (kraBhfId) set`,
      );
    }
    return {
      connection,
      ctx: {
        merchantId,
        branchId: connection.kraBhfId,
        kraPin: connection.kraPin,
        environment: connection.environment,
        cmcKey: connection.cmcKey,
        deviceId: connection.deviceId,
      },
    };
  }

  private lookupBody(
    connection: ComplianceConnection,
    lastReqDt?: string,
  ): Record<string, unknown> {
    return {
      tin: connection.kraPin,
      bhfId: connection.kraBhfId,
      cmcKey: connection.cmcKey,
      lastReqDt: lastReqDt ?? EPOCH_LAST_REQ_DT,
    };
  }

  private async logAndFinalize(
    operation: string,
    merchantId: string,
    branchId: string,
    connection: ComplianceConnection,
    body: Record<string, unknown>,
    envelope: OscuEnvelopeResponse,
  ): Promise<OscuEnvelopeResponse> {
    const rawResponse = envelope.rawResponse;
    await this.logRepo.save(
      this.logRepo.create({
        operation,
        merchantId,
        branchId,
        kraBhfId: connection.kraBhfId,
        requestBody: body,
        success: envelope.success,
        resultCd:
          typeof rawResponse?.['resultCd'] === 'string'
            ? rawResponse['resultCd']
            : null,
        resultMsg:
          typeof rawResponse?.['resultMsg'] === 'string'
            ? rawResponse['resultMsg']
            : null,
        rawResponse: rawResponse ?? null,
        errorMessage: envelope.error ?? null,
      }),
    );

    if (!envelope.success) {
      throw new BadRequestException(
        envelope.error ?? `OSCU operation ${operation} failed`,
      );
    }
    return envelope;
  }

  private async dispatch(
    operation: EnvelopeOperation,
    merchantId: string,
    branchId: string,
    buildBody: (connection: ComplianceConnection) => Record<string, unknown>,
  ): Promise<OscuEnvelopeResponse> {
    const { connection, ctx } = await this.resolveContext(merchantId, branchId);
    const body = buildBody(connection);

    let envelope: OscuEnvelopeResponse;
    try {
      envelope = await this.envelopeOperations[operation](body, ctx);
    } catch (err) {
      envelope = {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    return this.logAndFinalize(
      operation,
      merchantId,
      branchId,
      connection,
      body,
      envelope,
    );
  }

  // --- Lookups (server assembles tin/bhfId/cmcKey, caller only supplies watermark) ---

  branchList(merchantId: string, branchId: string, lastReqDt?: string) {
    return this.dispatch('branchList', merchantId, branchId, (c) =>
      this.lookupBody(c, lastReqDt),
    );
  }

  taxpayerInfo(merchantId: string, branchId: string, lastReqDt?: string) {
    return this.dispatch('selectTaxpayerInfo', merchantId, branchId, (c) =>
      this.lookupBody(c, lastReqDt),
    );
  }

  noticeList(merchantId: string, branchId: string, lastReqDt?: string) {
    return this.dispatch('selectNoticeList', merchantId, branchId, (c) =>
      this.lookupBody(c, lastReqDt),
    );
  }

  customerPinInfo(merchantId: string, branchId: string, lastReqDt?: string) {
    return this.dispatch('customerPinInfo', merchantId, branchId, (c) =>
      this.lookupBody(c, lastReqDt),
    );
  }

  importedItemInfo(merchantId: string, branchId: string, lastReqDt?: string) {
    return this.dispatch('importedItemInfo', merchantId, branchId, (c) =>
      this.lookupBody(c, lastReqDt),
    );
  }

  itemInfo(merchantId: string, branchId: string, lastReqDt?: string) {
    return this.dispatch('getItemInfo', merchantId, branchId, (c) =>
      this.lookupBody(c, lastReqDt),
    );
  }

  purchaseTransactionInfo(
    merchantId: string,
    branchId: string,
    lastReqDt?: string,
  ) {
    return this.dispatch(
      'getPurchaseTransactionInfo',
      merchantId,
      branchId,
      (c) => this.lookupBody(c, lastReqDt),
    );
  }

  async stockMoveList(
    merchantId: string,
    branchId: string,
    lastReqDt?: string,
  ) {
    const { connection, ctx } = await this.resolveContext(merchantId, branchId);
    const body = this.lookupBody(connection, lastReqDt);

    let envelope: OscuEnvelopeResponse;
    try {
      const result = await this.etimsAdapter.selectStockMoveList(
        body as unknown as Parameters<IEtimsAdapter['selectStockMoveList']>[0],
        ctx,
      );
      envelope = {
        success: result.success,
        rawResponse: result.rawResponse as unknown as
          | Record<string, unknown>
          | undefined,
        error: result.error,
      };
    } catch (err) {
      envelope = {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    return this.logAndFinalize(
      'selectStockMoveList',
      merchantId,
      branchId,
      connection,
      body,
      envelope,
    );
  }

  salesTransactions(merchantId: string, branchId: string, lastReqDt?: string) {
    return this.dispatch('selectSalesTransactions', merchantId, branchId, (c) =>
      this.lookupBody(c, lastReqDt),
    );
  }

  invoiceDetail(merchantId: string, branchId: string, invcNo: string) {
    return this.dispatch('selectInvoiceDetail', merchantId, branchId, (c) => ({
      tin: c.kraPin,
      bhfId: c.kraBhfId,
      cmcKey: c.cmcKey,
      invcNo,
    }));
  }

  // --- Writes (business payload supplied by caller as-is) ---

  saveBranchInsurance(
    merchantId: string,
    branchId: string,
    payload: Record<string, unknown>,
  ) {
    return this.dispatch(
      'branchInsuranceInfo',
      merchantId,
      branchId,
      () => payload,
    );
  }

  saveBranchUserAccount(
    merchantId: string,
    branchId: string,
    payload: Record<string, unknown>,
  ) {
    return this.dispatch(
      'branchUserAccount',
      merchantId,
      branchId,
      () => payload,
    );
  }

  saveBranchCustomer(
    merchantId: string,
    branchId: string,
    payload: Record<string, unknown>,
  ) {
    return this.dispatch(
      'branchSendCustomerInfo',
      merchantId,
      branchId,
      () => payload,
    );
  }

  convertImportedItem(
    merchantId: string,
    branchId: string,
    payload: Record<string, unknown>,
  ) {
    return this.dispatch(
      'importedItemConvertedInfo',
      merchantId,
      branchId,
      () => payload,
    );
  }

  saveItemComposition(
    merchantId: string,
    branchId: string,
    payload: Record<string, unknown>,
  ) {
    return this.dispatch(
      'saveItemComposition',
      merchantId,
      branchId,
      () => payload,
    );
  }

  sendPurchaseTransaction(
    merchantId: string,
    branchId: string,
    payload: Record<string, unknown>,
  ) {
    return this.dispatch(
      'sendPurchaseTransactionInfo',
      merchantId,
      branchId,
      () => payload,
    );
  }
}
