import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Put,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ActiveTenant } from '../../dashboard-identity/infrastructure/decorators/active-tenant.decorator';
import { ActiveTenantGuard } from '../../dashboard-identity/infrastructure/guards/active-tenant.guard';
import { DashboardAdminGuard } from '../../dashboard-identity/infrastructure/guards/dashboard-admin.guard';
import { DashboardJwtAuthGuard } from '../../dashboard-identity/infrastructure/guards/dashboard-jwt-auth.guard';
import {
  RECEIPT_LOGO_MAX_BYTES,
  ReceiptSettingsService,
  type UploadedLogoLike,
} from '../application/receipt-settings.service';

/**
 * Per-business receipt settings. Every handler takes its scope from
 * ActiveTenantGuard (the business must belong to the caller's organisation) --
 * no id is accepted from the body or path. Reads are open to any member of the
 * organisation (the receipt itself is); writes are admin-only.
 */
@Controller('dashboard-api/receipt-settings')
@ApiTags('Dashboard receipt settings (Mode B)')
@UseGuards(DashboardJwtAuthGuard, ActiveTenantGuard)
@ApiBearerAuth()
export class ReceiptSettingsController {
  constructor(private readonly settings: ReceiptSettingsService) {}

  @Get()
  @ApiOperation({ summary: "This business's receipt settings, the section catalogue (with locked sections) and KRA field limits" })
  async get(@ActiveTenant() tenantId: string) {
    return { success: true, message: 'OK', data: await this.settings.get(tenantId) };
  }

  @Put()
  @UseGuards(DashboardAdminGuard)
  @ApiOperation({ summary: 'Replace the receipt settings. Locked (mandatory) sections cannot be disabled; texts over KRA\'s limits are refused.' })
  async put(@ActiveTenant() tenantId: string, @Body() body: unknown) {
    return { success: true, message: 'Receipt settings saved', data: await this.settings.put(tenantId, body) };
  }

  @Post('logo')
  @UseGuards(DashboardAdminGuard)
  @ApiOperation({ summary: 'Upload the business logo (PNG/JPG by content, 512 KB maximum)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: RECEIPT_LOGO_MAX_BYTES, files: 1 } }),
  )
  async uploadLogo(
    @ActiveTenant() tenantId: string,
    @UploadedFile() file: UploadedLogoLike | undefined,
  ) {
    return { success: true, message: 'Logo uploaded', data: await this.settings.uploadLogo(tenantId, file) };
  }

  @Get('logo')
  @ApiOperation({ summary: "The business logo bytes (authenticated; fixed image type, never sniffed or rendered as a document)" })
  async logo(
    @ActiveTenant() tenantId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const logo = await this.settings.getLogo(tenantId);
    res.set({
      'Content-Type': logo.mime,
      'Content-Disposition': 'attachment; filename="logo"',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(logo.content);
  }

  @Delete('logo')
  @UseGuards(DashboardAdminGuard)
  @ApiOperation({ summary: 'Remove the business logo' })
  async deleteLogo(@ActiveTenant() tenantId: string) {
    return { success: true, message: 'Logo removed', data: await this.settings.deleteLogo(tenantId) };
  }
}
