import { Injectable } from '@nestjs/common';
import type { Standing } from '@trendlix/shared';
import { todayInCairo } from '../common/date-only.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CHECKED_EMPLOYMENT, completeness, papersOf, topGradeRank } from './completeness.js';
import { NEWEST_FIRST, PLACE } from './employees.service.js';
import { missingDetailsFileName, missingDetailsWorkbook } from './missing-workbook.js';

// The Missing Details report (owner's request, 16 October 2026: "i want to generate a report with the missing personal
// profile fields and documents"): what each profile still lacks, by the profile's own checklist (completeness.ts), for
// everyone at once. It names the papers of the employee file, so it is for HR and the CEO (seesEmployeeFile).

@Injectable()
export class MissingDetailsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every profile but former employees (whose last employment ended): those employed now and those not employed yet,
   * complete ones too (with nothing missing), least complete first, then by employee code. Each with where they stand
   * and work, as the directory shows them. Loaded in a few queries for everyone: the profiles with their national ID,
   * bank and latest employment, the papers in every file, and the top grade's rank. The national ID and bank are read
   * only for whether each detail is there; their values are never sent.
   */
  async report() {
    const [people, topRank] = await Promise.all([
      this.prisma.employee.findMany({
        where: { OR: [{ employments: { none: {} } }, { employments: { some: { endDate: null } } }] },
        include: {
          identity: true,
          bank: true,
          employments: {
            orderBy: NEWEST_FIRST,
            take: 1,
            select: { ...CHECKED_EMPLOYMENT, endDate: true, status: true, department: PLACE.department, jobTitle: { select: { id: true, titleEn: true } } },
          },
        },
        orderBy: { employeeCode: 'asc' },
      }),
      topGradeRank(this.prisma),
    ]);
    const papers = await papersOf(this.prisma, people.map((e) => e.id));

    const rows = people.map(({ identity, bank, employments: [latest], ...employee }) => {
      const current = latest && !latest.endDate ? latest : null;
      const { percent, missing } = completeness({
        employee,
        identity,
        bank,
        employment: current,
        latestType: latest?.employmentType ?? null,
        topRank,
        papers: papers.get(employee.id) ?? [],
      });
      return {
        id: employee.id,
        employeeCode: employee.employeeCode,
        fullNameEn: employee.fullNameEn,
        fullNameAr: employee.fullNameAr,
        standing: (current?.status ?? 'not_employed') as Standing,
        department: current?.department ?? null,
        jobTitle: current?.jobTitle ?? null,
        percent,
        missing,
      };
    });
    // a stable sort: people with the same percent stay in the order of their employee codes
    rows.sort((a, b) => a.percent - b.percent);
    return { generatedAt: new Date().toISOString(), rows };
  }

  /** The report as an Excel workbook, named with today's date in Cairo. */
  async workbook(): Promise<{ fileName: string; data: Buffer }> {
    const { rows } = await this.report();
    return { fileName: missingDetailsFileName(todayInCairo()), data: await missingDetailsWorkbook(rows) };
  }
}
