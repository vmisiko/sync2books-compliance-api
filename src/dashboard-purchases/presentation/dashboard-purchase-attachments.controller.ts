import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { DashboardJwtAuthGuard } from '../../dashboard-identity/infrastructure/guards/dashboard-jwt-auth.guard';
import { ActiveTenantGuard } from '../../dashboard-identity/infrastructure/guards/active-tenant.guard';
import { ActiveTenant } from '../../dashboard-identity/infrastructure/decorators/active-tenant.decorator';
import {
  PURCHASE_ATTACHMENT_MAX_BYTES,
  PurchaseAttachmentService,
  type UploadedFileLike,
} from '../application/purchase-attachment.service';

function setFileHeaders(res: Response, filename: string, mime: string): void {
  res.set({
    'Content-Type': mime,
    // Always a download, never rendered in the app's origin. The name is already sanitised.
    'Content-Disposition': `attachment; filename="${filename.replace(/["\\\r\n]/g, '_')}"`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  });
}

@Controller('dashboard-api/purchases')
@ApiTags('Dashboard purchase attachments (Mode B)')
@UseGuards(DashboardJwtAuthGuard, ActiveTenantGuard)
@ApiBearerAuth()
export class DashboardPurchaseAttachmentsController {
  constructor(private readonly attachments: PurchaseAttachmentService) {}

  @Get(':id/purchase-record.pdf')
  @ApiOperation({ summary: 'Generate the internal Purchase Record PDF for a purchase invoice' })
  async purchaseRecord(
    @ActiveTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const pdf = await this.attachments.purchaseRecord(tenantId, id);
    setFileHeaders(res, pdf.filename, 'application/pdf');
    return new StreamableFile(pdf.content);
  }

  @Get(':id/attachments')
  @ApiOperation({ summary: 'List attachments on a purchase invoice' })
  async list(
    @ActiveTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.attachments.list(tenantId, id);
    return { success: true, message: 'OK', data };
  }

  @Post(':id/attachments')
  @ApiOperation({
    summary:
      'Upload a PDF/JPG/PNG (10 MB, 10 per invoice; type checked by content). With pushToErp=true the file is also attached to the synced ERP bill; an ERP failure does not fail the upload.',
  })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: PURCHASE_ATTACHMENT_MAX_BYTES, files: 1 },
    }),
  )
  async upload(
    @ActiveTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedFileLike | undefined,
    @Body() body: { pushToErp?: string },
  ) {
    const { attachment, pushError } = await this.attachments.upload(tenantId, id, file, {
      pushToErp: body?.pushToErp === 'true',
    });
    return {
      success: true,
      message: pushError ? 'File uploaded, but the ERP attachment failed' : 'File uploaded',
      data: attachment,
      pushError,
    };
  }

  @Get(':id/attachments/:aid')
  @ApiOperation({ summary: 'Download an attachment (never inline)' })
  async download(
    @ActiveTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('aid', ParseUUIDPipe) aid: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.attachments.download(tenantId, id, aid);
    setFileHeaders(res, file.filename, file.mime);
    return new StreamableFile(file.content);
  }

  @Delete(':id/attachments/:aid')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete an attachment from Sync2Books (a copy already pushed to the ERP is not removed)' })
  async remove(
    @ActiveTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('aid', ParseUUIDPipe) aid: string,
  ) {
    await this.attachments.remove(tenantId, id, aid);
    return { success: true, message: 'Attachment deleted' };
  }

  @Post(':id/attachments/:aid/push-to-erp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Attach this file to the purchase invoice\'s synced ERP bill (safe to retry)' })
  async pushToErp(
    @ActiveTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('aid', ParseUUIDPipe) aid: string,
  ) {
    const data = await this.attachments.pushToErp(tenantId, id, aid);
    return {
      success: data.erpPushStatus !== 'failed',
      message:
        data.erpPushStatus === 'failed'
          ? (data.erpPushError ?? 'ERP attachment failed')
          : 'Attached to the ERP bill',
      data,
    };
  }
}
