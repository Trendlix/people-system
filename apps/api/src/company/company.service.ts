import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService, changes } from '../audit/audit.service.js';
import type { Company } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { UpdateCompanyDto } from './company.dto.js';
import { detectLogoType, LOGO_MAX_BYTES } from './logo-type.js';

const ENTITY = 'company';
const ID = 1;

/** The company profile as the API returns it: no logo bytes, national ID masked. */
export type CompanyView = Omit<Company, 'id' | 'logo' | 'logoMimeType' | 'repNationalId'> & {
  repNationalIdMasked: string | null;
  hasLogo: boolean;
};

/** Public: shown on the sign-in page and in the sidebar. */
export interface CompanyBrand {
  nameEn: string;
  nameAr: string | null;
  logoVersion: number | null;
}

function view(c: Company): CompanyView {
  const { id: _id, logo, logoMimeType: _type, repNationalId, ...rest } = c;
  return {
    ...rest,
    repNationalIdMasked: repNationalId ? `•••••••••• ${repNationalId.slice(-4)}` : null,
    hasLogo: logo !== null,
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
      select: { nameEn: true, nameAr: true, logoUpdatedAt: true },
    });
    return { nameEn: c?.nameEn ?? 'Company', nameAr: c?.nameAr ?? null, logoVersion: c?.logoUpdatedAt?.getTime() ?? null };
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

  async setLogo(file: Express.Multer.File | undefined, userId: string): Promise<CompanyView> {
    if (!file?.buffer?.length) throw new BadRequestException('Choose an image file to upload.');
    if (file.size > LOGO_MAX_BYTES) throw new BadRequestException('The logo must be 1 MB or smaller.');
    const type = detectLogoType(file.buffer);
    if (!type) throw new BadRequestException('The logo must be a PNG, JPEG or WebP image.');

    await this.row();
    const updated = await this.prisma.company.update({
      where: { id: ID },
      data: { logo: new Uint8Array(file.buffer), logoMimeType: type, logoUpdatedAt: new Date() },
    });
    await this.audit.record({ userId, action: 'update', entityType: ENTITY, diff: { logo: { type, bytes: file.size } } });
    return view(updated);
  }

  async removeLogo(userId: string): Promise<void> {
    await this.row();
    await this.prisma.company.update({ where: { id: ID }, data: { logo: null, logoMimeType: null, logoUpdatedAt: null } });
    await this.audit.record({ userId, action: 'update', entityType: ENTITY, diff: { logo: 'removed' } });
  }

  async logo(): Promise<{ data: Buffer; type: string }> {
    const c = await this.prisma.company.findUnique({ where: { id: ID }, select: { logo: true, logoMimeType: true } });
    if (!c?.logo || !c.logoMimeType) throw new NotFoundException('No logo uploaded.');
    return { data: Buffer.from(c.logo), type: c.logoMimeType };
  }
}
