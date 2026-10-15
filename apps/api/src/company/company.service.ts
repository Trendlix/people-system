import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService, changes } from '../audit/audit.service.js';
import { assertDeletes } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import type { Company, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { UpdateCompanyDto } from './company.dto.js';
import { detectLogoType, LOGO_MAX_BYTES } from './logo-type.js';

const ENTITY = 'company';
const ID = 1;

/**
 * The company's two images, kept alike: the logo (the wide wordmark) and the thumbnail beside it, a square brand mark
 * shown as the browser tab icon and where the logo has no room (owner's request, 15 October 2026). Each is checked the
 * same way (PNG, JPEG or WebP by its first bytes, up to 1 MB), served publicly, versioned by its upload time, and removed
 * by a Super Admin only.
 */
export type CompanyImage = 'logo' | 'thumbnail';

/** Each image's columns: its bytes, its type and its upload time (its version; set exactly when there is an image). */
const COLUMNS = {
  logo: { data: 'logo', type: 'logoMimeType', updatedAt: 'logoUpdatedAt' },
  thumbnail: { data: 'thumbnail', type: 'thumbnailMimeType', updatedAt: 'thumbnailUpdatedAt' },
} as const satisfies Record<CompanyImage, { data: keyof Company; type: keyof Company; updatedAt: keyof Company }>;

/** The columns of `image` set to an upload, or emptied (null). */
function imageColumns(image: CompanyImage, upload: { data: Uint8Array<ArrayBuffer>; type: string; at: Date } | null): Prisma.CompanyUpdateInput {
  const c = COLUMNS[image];
  return { [c.data]: upload?.data ?? null, [c.type]: upload?.type ?? null, [c.updatedAt]: upload?.at ?? null };
}

/** The company profile as the API returns it: no image bytes, national ID masked. */
export type CompanyView = Omit<Company, 'id' | 'logo' | 'logoMimeType' | 'thumbnail' | 'thumbnailMimeType' | 'repNationalId'> & {
  repNationalIdMasked: string | null;
  hasLogo: boolean;
  hasThumbnail: boolean;
};

/** Public: shown on the sign-in page, in the sidebar and as the browser tab icon. A version is null when there is no image. */
export interface CompanyBrand {
  nameEn: string;
  nameAr: string | null;
  logoVersion: number | null;
  thumbnailVersion: number | null;
}

function view(c: Company): CompanyView {
  const { id: _id, logo, logoMimeType: _logoType, thumbnail, thumbnailMimeType: _thumbnailType, repNationalId, ...rest } = c;
  return {
    ...rest,
    repNationalIdMasked: repNationalId ? `•••••••••• ${repNationalId.slice(-4)}` : null,
    hasLogo: logo !== null,
    hasThumbnail: thumbnail !== null,
  };
}

@Injectable()
export class CompanyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The single company row; created with a placeholder name if the seed has not run. */
  private async row(): Promise<Company> {
    return this.prisma.company.upsert({ where: { id: ID }, update: {}, create: { id: ID, nameEn: 'Company' } });
  }

  async get(): Promise<CompanyView> {
    return view(await this.row());
  }

  async brand(): Promise<CompanyBrand> {
    const c = await this.prisma.company.findUnique({
      where: { id: ID },
      select: { nameEn: true, nameAr: true, logoUpdatedAt: true, thumbnailUpdatedAt: true },
    });
    return {
      nameEn: c?.nameEn ?? 'Company',
      nameAr: c?.nameAr ?? null,
      logoVersion: c?.logoUpdatedAt?.getTime() ?? null,
      thumbnailVersion: c?.thumbnailUpdatedAt?.getTime() ?? null,
    };
  }

  async update(dto: UpdateCompanyDto, userId: string): Promise<CompanyView> {
    const before = await this.row();
    const data = Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined));
    const updated = await this.prisma.company.update({ where: { id: ID }, data });

    const { repNationalId, ...fields } = dto;
    const diff: Record<string, unknown> = changes(before, fields);
    if (repNationalId !== undefined && repNationalId !== before.repNationalId) {
      diff.repNationalId = 'changed'; // restricted: never written to the log
    }
    if (Object.keys(diff).length) await this.audit.record({ userId, action: 'update', entityType: ENTITY, diff });
    return view(updated);
  }

  /** Uploads (or replaces) the logo or the thumbnail: an update, for HR and Admin. */
  async setImage(image: CompanyImage, file: Express.Multer.File | undefined, userId: string): Promise<CompanyView> {
    if (!file?.buffer?.length) throw new BadRequestException('Choose an image file to upload.');
    if (file.size > LOGO_MAX_BYTES) throw new BadRequestException(`The ${image} must be 1 MB or smaller.`);
    const type = detectLogoType(file.buffer);
    if (!type) throw new BadRequestException(`The ${image} must be a PNG, JPEG or WebP image.`);

    await this.row();
    const updated = await this.prisma.company.update({
      where: { id: ID },
      data: imageColumns(image, { data: new Uint8Array(file.buffer), type, at: new Date() }),
    });
    await this.audit.record({ userId, action: 'update', entityType: ENTITY, diff: { [image]: { type, bytes: file.size } } });
    return view(updated);
  }

  /** Removing the logo or the thumbnail deletes it, so a Super Admin only (owner's decision, 15 October 2026); replacing it is an update. */
  async removeImage(image: CompanyImage, user: SessionUser): Promise<void> {
    assertDeletes(user);
    await this.row();
    await this.prisma.company.update({ where: { id: ID }, data: imageColumns(image, null) });
    await this.audit.record({ userId: user.id, action: 'update', entityType: ENTITY, diff: { [image]: 'removed' } });
  }

  /** The logo's or the thumbnail's bytes and type, for the public file endpoints. */
  async image(image: CompanyImage): Promise<{ data: Buffer; type: string }> {
    const logo = image === 'logo'; // only the asked-for image's bytes are loaded
    const row = await this.prisma.company.findUnique({
      where: { id: ID },
      select: { logo, logoMimeType: logo, thumbnail: !logo, thumbnailMimeType: !logo },
    });
    const c = COLUMNS[image];
    const data = row?.[c.data];
    const type = row?.[c.type];
    if (!data || !type) throw new NotFoundException(`No ${image} uploaded.`);
    return { data: Buffer.from(data), type };
  }
}
