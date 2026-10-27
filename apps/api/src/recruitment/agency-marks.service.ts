import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { agencyOfCompany, companyKey } from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { SetAgencyMarkDto } from './agency-marks.dto.js';
import { CvReadingsService } from './cv-readings.service.js';

export const AGENCY_MARK_ENTITY = 'agency_mark';

/** A mark as the API sends it: the company as written, whether an agency, who set it last and when. */
export interface AgencyMarkView {
  id: string;
  name: string;
  agency: boolean;
  /** What its name's words alone say (without the mark), for the list to show where the mark differs. */
  byName: boolean;
  updatedAt: string;
}

// HR's list of marketing agencies (owner, 27 October 2026: "when opening a job, can the OCR detect if his previous works
// are in agency?", then "i need a flag if the candidate is ex marketing agencies or not AND reflectin the scoring"; he
// chose "Name words + your list"): a company marked a marketing agency, or not one, by its name as compared (companyKey),
// wins over its name's words in every CV's work history (packages/shared marketing-agencies.ts). HR (and a Super Admin)
// set and remove marks, from the list or from a CV's work history; everyone who reads recruitment reads them. Each change
// is audited, and the applications whose CV names the company are scored again at once (the earlier CVs' suggestions on
// the recruitment round).
@Injectable()
export class AgencyMarksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly readings: CvReadingsService,
  ) {}

  /** Every mark, by name. */
  async list(): Promise<AgencyMarkView[]> {
    const rows = await this.prisma.agencyMark.findMany({ orderBy: { name: 'asc' } });
    return rows.map((r) => ({ id: r.id, name: r.name, agency: r.agency, byName: agencyOfCompany(r.name).agency, updatedAt: r.updatedAt.toISOString() }));
  }

  /** A company marked a marketing agency or not (set again: changed), audited; its CVs' applications scored again. */
  async set(dto: SetAgencyMarkDto, user: SessionUser): Promise<AgencyMarkView> {
    const name = dto.company.trim();
    const key = companyKey(name);
    if (!key) throw new BadRequestException(['Write the company’s name, e.g. Publicis Egypt.']);
    const before = await this.prisma.agencyMark.findUnique({ where: { key } });
    const row = await this.prisma.agencyMark.upsert({
      where: { key },
      create: { key, name, agency: dto.agency, updatedById: user.id },
      update: { name, agency: dto.agency, updatedById: user.id },
    });
    if (!before || before.agency !== dto.agency) {
      await this.audit.record({
        userId: user.id,
        action: before ? 'update' : 'create',
        entityType: AGENCY_MARK_ENTITY,
        entityId: row.id,
        diff: { name, agency: before ? { from: before.agency, to: dto.agency } : dto.agency },
      });
      await this.rescore(name);
    }
    return { id: row.id, name: row.name, agency: row.agency, byName: agencyOfCompany(row.name).agency, updatedAt: row.updatedAt.toISOString() };
  }

  /** A mark removed: the company is told by its name's words again; audited, its CVs' applications scored again. */
  async remove(id: string, user: SessionUser): Promise<void> {
    const row = await this.prisma.agencyMark.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Mark not found.');
    await this.prisma.agencyMark.delete({ where: { id } });
    await this.audit.record({ userId: user.id, action: 'delete', entityType: AGENCY_MARK_ENTITY, entityId: id, diff: { name: row.name, agency: row.agency } });
    await this.rescore(row.name);
  }

  /**
   * The applications whose CV's text names the company scored again; how many changed. Its name's words found in order,
   * whatever the case and spacing between them, the Arabic letters the comparison folds (ا, ه, ي) any letter there.
   */
  private async rescore(name: string): Promise<number> {
    const words = companyKey(name)
      .split(' ')
      .filter(Boolean)
      .map((w) => w.replace(/[\\%_]/g, (c) => `\\${c}`).replace(/[اهي]/g, '_'));
    if (!words.length) return 0;
    const like = `%${words.join('%')}%`;
    const rows = await this.prisma.$queryRaw<{ application_id: string }[]>`SELECT application_id FROM cv_readings
      WHERE application_id IS NOT NULL AND status = 'read' AND text ILIKE ${like}`;
    let changed = 0;
    for (const r of rows) if (await this.readings.rescoreApplication(r.application_id)) changed++;
    return changed;
  }
}
