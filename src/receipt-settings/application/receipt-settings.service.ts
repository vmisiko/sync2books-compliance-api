import {
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as crypto from 'crypto';
import { Repository } from 'typeorm';
import {
  EMPTY_RECEIPT_SETTINGS,
  RECEIPT_FIELD_LIMITS,
  RECEIPT_SECTIONS,
  type ReceiptSettingsData,
  validateReceiptSettingsInput,
  ReceiptSettingsValidationError,
} from '../domain/receipt-settings.model';
import { ReceiptSettingsOrmEntity } from '../infrastructure/receipt-settings.orm-entity';
import { BadRequestException } from '@nestjs/common';

export const RECEIPT_LOGO_MAX_BYTES = 512 * 1024;
/** Pixel cap so a tiny file cannot decode into a huge bitmap when the PDF is rendered. */
export const RECEIPT_LOGO_MAX_DIMENSION = 4000;

export interface UploadedLogoLike {
  buffer?: Buffer;
  size?: number;
}

export interface ReceiptSettingsDto {
  settings: ReceiptSettingsData;
  sections: typeof RECEIPT_SECTIONS;
  limits: typeof RECEIPT_FIELD_LIMITS;
  logo: { present: boolean; mime: string | null; size: number | null; updatedAt: Date | null };
}

/** PNG / JPEG only, by magic bytes -- the client-declared type is never trusted. */
export function detectLogoType(buf: Buffer): { mime: 'image/png' | 'image/jpeg' } | null {
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { mime: 'image/png' };
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { mime: 'image/jpeg' };
  }
  return null;
}

/** Image dimensions straight from the header; null when the header is malformed. */
export function readLogoDimensions(
  buf: Buffer,
  mime: 'image/png' | 'image/jpeg',
): { width: number; height: number } | null {
  if (mime === 'image/png') {
    if (buf.length < 24 || buf.subarray(12, 16).toString('latin1') !== 'IHDR') return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = buf.readUInt16BE(i + 2);
    // SOF0-SOF15 except DHT(c4), JPG(c8), DAC(cc)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

@Injectable()
export class ReceiptSettingsService {
  constructor(
    @InjectRepository(ReceiptSettingsOrmEntity)
    private readonly repo: Repository<ReceiptSettingsOrmEntity>,
  ) {}

  /** `tenantId` is always the caller's own, verified by ActiveTenantGuard (or the document's own business). */
  private async findRow(tenantId: string): Promise<ReceiptSettingsOrmEntity | null> {
    return this.repo.findOne({ where: { tenantId } });
  }

  async get(tenantId: string): Promise<ReceiptSettingsDto> {
    const row = await this.findRow(tenantId);
    return this.toDto(row);
  }

  /** Settings + whether a logo exists, for the receipt resolver. Never loads the logo bytes. */
  async getForRender(tenantId: string): Promise<{ settings: ReceiptSettingsData; hasLogo: boolean }> {
    const row = await this.findRow(tenantId);
    return { settings: row?.settings ?? EMPTY_RECEIPT_SETTINGS, hasLogo: row?.logoSize != null };
  }

  async put(tenantId: string, input: unknown): Promise<ReceiptSettingsDto> {
    let settings: ReceiptSettingsData;
    try {
      settings = validateReceiptSettingsInput(input);
    } catch (err) {
      if (err instanceof ReceiptSettingsValidationError) throw new BadRequestException(err.message);
      throw err;
    }
    const existing = await this.findRow(tenantId);
    if (existing) {
      await this.repo.update({ tenantId }, { settings });
    } else {
      await this.repo.save(this.repo.create({ tenantId, settings, logoMime: null, logoSize: null, logoSha256: null, logoContent: null }));
    }
    return this.toDto(await this.findRow(tenantId));
  }

  async uploadLogo(tenantId: string, file: UploadedLogoLike | undefined): Promise<ReceiptSettingsDto> {
    if (!file?.buffer || file.buffer.length === 0) {
      throw new BadRequestException('Attach a PNG or JPG logo as the "file" field.');
    }
    if (file.buffer.length > RECEIPT_LOGO_MAX_BYTES) {
      throw new PayloadTooLargeException('The logo must be 512 KB or smaller.');
    }
    const type = detectLogoType(file.buffer);
    if (!type) {
      throw new UnsupportedMediaTypeException('The logo must be a PNG or JPG image.');
    }
    const dims = readLogoDimensions(file.buffer, type.mime);
    if (!dims || dims.width < 1 || dims.height < 1) {
      throw new UnsupportedMediaTypeException('The logo image could not be read.');
    }
    if (dims.width > RECEIPT_LOGO_MAX_DIMENSION || dims.height > RECEIPT_LOGO_MAX_DIMENSION) {
      throw new PayloadTooLargeException(`The logo must be at most ${RECEIPT_LOGO_MAX_DIMENSION}px on each side.`);
    }
    const logo = {
      logoMime: type.mime,
      logoSize: file.buffer.length,
      logoSha256: crypto.createHash('sha256').update(file.buffer).digest('hex'),
      logoContent: file.buffer,
    };
    const existing = await this.findRow(tenantId);
    if (existing) {
      await this.repo.update({ tenantId }, logo);
    } else {
      await this.repo.save(this.repo.create({ tenantId, settings: EMPTY_RECEIPT_SETTINGS, ...logo }));
    }
    return this.toDto(await this.findRow(tenantId));
  }

  /** Bytes for an authenticated GET and for the PDF. 404 when this business has no logo. */
  async getLogo(tenantId: string): Promise<{ content: Buffer; mime: string }> {
    const logo = await this.findLogo(tenantId);
    if (!logo) throw new NotFoundException('No logo uploaded.');
    return logo;
  }

  /** Null instead of 404, for the renderer. */
  async findLogo(tenantId: string): Promise<{ content: Buffer; mime: string } | null> {
    const row = await this.repo
      .createQueryBuilder('r')
      .addSelect('r.logoContent')
      .where('r.tenantId = :tenantId', { tenantId })
      .getOne();
    if (!row?.logoContent || !row.logoMime) return null;
    return { content: row.logoContent, mime: row.logoMime };
  }

  async deleteLogo(tenantId: string): Promise<ReceiptSettingsDto> {
    const existing = await this.findRow(tenantId);
    if (!existing || existing.logoSize == null) throw new NotFoundException('No logo uploaded.');
    await this.repo.update({ tenantId }, { logoMime: null, logoSize: null, logoSha256: null, logoContent: null });
    return this.toDto(await this.findRow(tenantId));
  }

  private toDto(row: ReceiptSettingsOrmEntity | null): ReceiptSettingsDto {
    return {
      settings: row?.settings ?? EMPTY_RECEIPT_SETTINGS,
      sections: RECEIPT_SECTIONS,
      limits: RECEIPT_FIELD_LIMITS,
      logo: {
        present: row?.logoSize != null,
        mime: row?.logoMime ?? null,
        size: row?.logoSize ?? null,
        updatedAt: row?.updatedAt ?? null,
      },
    };
  }
}
