import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { OscuOperationsService } from './oscu-operations.service';
import {
  OscuInvoiceDetailQueryDto,
  OscuLookupQueryDto,
  OscuWriteBodyDto,
} from './dto/oscu-lookup-query.dto';
import { ComplianceServiceAuthGuard } from '../../../integration/compliance-service-auth.guard';

/**
 * Thin pass-through routes over `IEtimsAdapter` for the raw OSCU/eTIMS operations that have
 * no dedicated domain flow yet (KRA Go-Live certification test cases). Every call is logged
 * to `oscu_operation_logs` for evidence/audit purposes.
 */
@Controller('oscu')
@ApiTags('OSCU Operations')
@UseGuards(ComplianceServiceAuthGuard)
export class OscuOperationsController {
  constructor(private readonly oscu: OscuOperationsService) {}

  // --- Data Management ---

  @Get('branches')
  @ApiOperation({ summary: 'branchList — fetch the OSCU branch list' })
  @ApiResponse({ status: 200, description: 'Branch list' })
  branchList(@Query() query: OscuLookupQueryDto) {
    return this.oscu.branchList(
      query.merchantId,
      query.branchId,
      query.lastReqDt,
    );
  }

  @Get('taxpayer-info')
  @ApiOperation({ summary: 'selectTaxpayerInfo — fetch taxpayer info' })
  @ApiResponse({ status: 200, description: 'Taxpayer info' })
  taxpayerInfo(@Query() query: OscuLookupQueryDto) {
    return this.oscu.taxpayerInfo(
      query.merchantId,
      query.branchId,
      query.lastReqDt,
    );
  }

  @Get('notices')
  @ApiOperation({ summary: 'selectNoticeList — fetch the OSCU notice list' })
  @ApiResponse({ status: 200, description: 'Notice list' })
  noticeList(@Query() query: OscuLookupQueryDto) {
    return this.oscu.noticeList(
      query.merchantId,
      query.branchId,
      query.lastReqDt,
    );
  }

  @Get('customer-pin-info')
  @ApiOperation({ summary: 'customerPinInfo — fetch customer PIN info' })
  @ApiResponse({ status: 200, description: 'Customer PIN info' })
  customerPinInfo(@Query() query: OscuLookupQueryDto) {
    return this.oscu.customerPinInfo(
      query.merchantId,
      query.branchId,
      query.lastReqDt,
    );
  }

  @Get('customers')
  @ApiOperation({
    summary:
      'selectCustomerList — fetch customer records since lastReqDt (previously sent via branchSendCustomerInfo)',
  })
  @ApiResponse({ status: 200, description: 'Customer list' })
  customerList(@Query() query: OscuLookupQueryDto) {
    return this.oscu.customerList(
      query.merchantId,
      query.branchId,
      query.lastReqDt,
    );
  }

  // --- Imports ---

  @Get('imported-items')
  @ApiOperation({
    summary: 'importedItemInfo — fetch imported item information',
  })
  @ApiResponse({ status: 200, description: 'Imported item info' })
  importedItemInfo(@Query() query: OscuLookupQueryDto) {
    return this.oscu.importedItemInfo(
      query.merchantId,
      query.branchId,
      query.lastReqDt,
    );
  }

  @Post('imported-items/convert')
  @ApiOperation({
    summary:
      'importedItemConvertedInfo — send converted imported item info (taskCd, dclDe, itemSeq, hsCd, itemClsCd, itemCd, imptItemSttsCd, ...)',
  })
  @ApiResponse({
    status: 201,
    description: 'Converted imported item info accepted',
  })
  convertImportedItem(
    @Body() body: OscuWriteBodyDto & Record<string, unknown>,
  ) {
    const { merchantId, branchId, ...payload } = body;
    return this.oscu.convertImportedItem(merchantId, branchId, payload);
  }

  // --- Branch Information Management ---

  @Post('branches/insurance')
  @ApiOperation({
    summary:
      'branchInsuranceInfo — send branch insurance info (isrccCd, isrccNm, isrcRt, useYn, regrNm, regrId, ...)',
  })
  @ApiResponse({ status: 201, description: 'Branch insurance info accepted' })
  saveBranchInsurance(
    @Body() body: OscuWriteBodyDto & Record<string, unknown>,
  ) {
    const { merchantId, branchId, ...payload } = body;
    return this.oscu.saveBranchInsurance(merchantId, branchId, payload);
  }

  @Post('branches/user-account')
  @ApiOperation({
    summary:
      'branchUserAccount — send branch user account (userId, userNm, pwd, useYn, regrNm, regrId, ...)',
  })
  @ApiResponse({ status: 201, description: 'Branch user account accepted' })
  saveBranchUserAccount(
    @Body() body: OscuWriteBodyDto & Record<string, unknown>,
  ) {
    const { merchantId, branchId, ...payload } = body;
    return this.oscu.saveBranchUserAccount(merchantId, branchId, payload);
  }

  @Post('branches/customer')
  @ApiOperation({
    summary:
      'branchSendCustomerInfo — send customer info (custNo, custTin, custNm, useYn, regrNm, regrId, ...)',
  })
  @ApiResponse({ status: 201, description: 'Customer info accepted' })
  saveBranchCustomer(@Body() body: OscuWriteBodyDto & Record<string, unknown>) {
    const { merchantId, branchId, ...payload } = body;
    return this.oscu.saveBranchCustomer(merchantId, branchId, payload);
  }

  // --- Item Management ---

  @Get('items/info')
  @ApiOperation({ summary: 'itemInfo — fetch item info' })
  @ApiResponse({ status: 200, description: 'Item info' })
  itemInfo(@Query() query: OscuLookupQueryDto) {
    return this.oscu.itemInfo(
      query.merchantId,
      query.branchId,
      query.lastReqDt,
    );
  }

  @Post('items/composition')
  @ApiOperation({
    summary:
      'saveItemComposition — send item composition (itemCd, cpstItemCd, cpstQty, regrId, regrNm)',
  })
  @ApiResponse({ status: 201, description: 'Item composition accepted' })
  saveItemComposition(
    @Body() body: OscuWriteBodyDto & Record<string, unknown>,
  ) {
    const { merchantId, branchId, ...payload } = body;
    return this.oscu.saveItemComposition(merchantId, branchId, payload);
  }

  // --- Purchase Management ---

  @Get('purchases')
  @ApiOperation({
    summary: 'getPurchaseTransactionInfo — fetch purchase transaction info',
  })
  @ApiResponse({ status: 200, description: 'Purchase transaction info' })
  purchaseTransactionInfo(@Query() query: OscuLookupQueryDto) {
    return this.oscu.purchaseTransactionInfo(
      query.merchantId,
      query.branchId,
      query.lastReqDt,
    );
  }

  @Post('purchases')
  @ApiOperation({
    summary:
      'sendPurchaseTransactionInfo — send purchase transaction info (invcNo, spplrTin, spplrNm, itemList, ...)',
  })
  @ApiResponse({ status: 201, description: 'Purchase transaction accepted' })
  sendPurchaseTransaction(
    @Body() body: OscuWriteBodyDto & Record<string, unknown>,
  ) {
    const { merchantId, branchId, ...payload } = body;
    return this.oscu.sendPurchaseTransaction(merchantId, branchId, payload);
  }

  // --- Sales Management (queries) ---

  @Get('sales/invoice-detail')
  @ApiOperation({
    summary: 'selectInvoiceDetail — fetch a single invoice by invcNo',
  })
  @ApiResponse({ status: 200, description: 'Invoice detail' })
  invoiceDetail(@Query() query: OscuInvoiceDetailQueryDto) {
    return this.oscu.invoiceDetail(
      query.merchantId,
      query.branchId,
      query.invcNo,
    );
  }

  @Get('sales/transactions')
  @ApiOperation({
    summary:
      'selectSalesTransactions — fetch sales transactions since lastReqDt',
  })
  @ApiResponse({ status: 200, description: 'Sales transactions' })
  salesTransactions(@Query() query: OscuLookupQueryDto) {
    return this.oscu.salesTransactions(
      query.merchantId,
      query.branchId,
      query.lastReqDt,
    );
  }

  // --- Stock Information Management ---

  @Get('stock/movements')
  @ApiOperation({
    summary: 'selectStockMoveLists — fetch stock movements since lastReqDt',
  })
  @ApiResponse({ status: 200, description: 'Stock movements' })
  stockMoveList(@Query() query: OscuLookupQueryDto) {
    return this.oscu.stockMoveList(
      query.merchantId,
      query.branchId,
      query.lastReqDt,
    );
  }
}
