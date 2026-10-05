import {
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import {
  RECEIPT_LOGO_MAX_BYTES,
  ReceiptSettingsService,
  detectLogoType,
} from './receipt-settings.service';
import type { ReceiptSettingsOrmEntity } from '../infrastructure/receipt-settings.orm-entity';

function png(width = 40, height = 20, pad = 0): Buffer {
  const head = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0);
  head.writeUInt32BE(13, 8);
  head.write('IHDR', 12, 'latin1');
  head.writeUInt32BE(width, 16);
  head.writeUInt32BE(height, 20);
  return Buffer.concat([head, Buffer.alloc(pad)]);
}
const PDF = Buffer.from('%PDF-1.4\nbody');
const GIF = Buffer.from('GIF89a......');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

function build() {
  const rows = new Map<string, Partial<ReceiptSettingsOrmEntity>>();
  const repo = {
    findOne: jest.fn(async ({ where }: any) => rows.get(where.tenantId) ?? null),
    create: (x: any) => ({ ...x }),
    save: jest.fn(async (x: any) => (rows.set(x.tenantId, { ...x, updatedAt: new Date() }), x)),
    update: jest.fn(async (crit: any, patch: any) => {
      const r = rows.get(crit.tenantId);
      if (r) Object.assign(r, patch);
    }),
    createQueryBuilder: jest.fn(() => {
      const params: any = {};
      const qb: any = {
        addSelect: () => qb,
        where: (_s: string, p: any) => (Object.assign(params, p), qb),
        getOne: async () => rows.get(params.tenantId) ?? null,
      };
      return qb;
    }),
  };
  return { svc: new ReceiptSettingsService(repo as any), rows, repo };
}

describe('ReceiptSettingsService logo upload', () => {
  it('accepts a real PNG and stores type/size/hash from the content, not the client', async () => {
    const { svc, rows } = build();
    const dto = await svc.uploadLogo('t-a', { buffer: png() });
    expect(dto.logo).toMatchObject({ present: true, mime: 'image/png' });
    expect(rows.get('t-a')!.logoSha256).toHaveLength(64);
  });

  it.each([
    ['PDF bytes', PDF],
    ['GIF bytes', GIF],
    ['SVG (script) bytes', SVG],
    ['a text file named .png', Buffer.from('not an image at all')],
  ])('rejects %s with 415 (wrong magic bytes)', async (_n, buf) => {
    const { svc, rows } = build();
    await expect(svc.uploadLogo('t-a', { buffer: buf })).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
    expect(rows.size).toBe(0);
  });

  it('rejects an oversize logo with 413', async () => {
    const { svc } = build();
    await expect(
      svc.uploadLogo('t-a', { buffer: png(40, 20, RECEIPT_LOGO_MAX_BYTES) }),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
  });

  it('rejects a pixel bomb (tiny file, huge dimensions) with 413 and a truncated header with 415', async () => {
    const { svc } = build();
    await expect(svc.uploadLogo('t-a', { buffer: png(60000, 60000) })).rejects.toBeInstanceOf(PayloadTooLargeException);
    await expect(
      svc.uploadLogo('t-a', { buffer: png().subarray(0, 12) }),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
  });

  it('rejects a missing file with 400', async () => {
    const { svc } = build();
    await expect(svc.uploadLogo('t-a', undefined)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('detectLogoType ignores everything but PNG/JPEG magic', () => {
    expect(detectLogoType(png())?.mime).toBe('image/png');
    expect(detectLogoType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))?.mime).toBe('image/jpeg');
    expect(detectLogoType(GIF)).toBeNull();
  });
});

describe('ReceiptSettingsService tenant isolation', () => {
  it("another business's logo is a 404, never the bytes; each business reads only its own settings", async () => {
    const { svc } = build();
    await svc.uploadLogo('t-a', { buffer: png() });
    await svc.put('t-a', { texts: { headerMessage: 'Karibu' } });

    await expect(svc.getLogo('t-b')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.deleteLogo('t-b')).rejects.toBeInstanceOf(NotFoundException);
    expect((await svc.get('t-b')).settings.texts).toEqual({});
    expect((await svc.get('t-b')).logo.present).toBe(false);
    expect(await svc.findLogo('t-b')).toBeNull();

    expect((await svc.get('t-a')).settings.texts.headerMessage).toBe('Karibu');
    expect((await svc.getLogo('t-a')).mime).toBe('image/png');
  });

  it("deleting one business's logo leaves the other's", async () => {
    const { svc } = build();
    await svc.uploadLogo('t-a', { buffer: png() });
    await svc.uploadLogo('t-b', { buffer: png(10, 10) });
    await svc.deleteLogo('t-a');
    await expect(svc.getLogo('t-a')).rejects.toBeInstanceOf(NotFoundException);
    expect((await svc.getLogo('t-b')).mime).toBe('image/png');
  });
});

describe('ReceiptSettingsService.put', () => {
  it('refuses to disable a mandatory section with 400 and stores nothing', async () => {
    const { svc, rows } = build();
    await expect(svc.put('t-a', { sections: { taxTable: { enabled: false } } })).rejects.toBeInstanceOf(BadRequestException);
    expect(rows.size).toBe(0);
  });

  it('keeps the logo when settings are saved', async () => {
    const { svc } = build();
    await svc.uploadLogo('t-a', { buffer: png() });
    const dto = await svc.put('t-a', { sections: { logo: { enabled: true } } });
    expect(dto.logo.present).toBe(true);
    expect(dto.settings.sections.logo.enabled).toBe(true);
  });
});
