import { cvPositions, OTHER_POSITION, teamIdOfKey, type CvPosition, type PositionChoice } from '@trendlix/shared';
import type { PrismaService } from '../prisma/prisma.service.js';

// The positions on "Send us your CV" (owner, 25 October 2026: "should it be the positions?"; asked, "Position, grouped by
// team"; packages/shared cv-positions.ts): every job title of the organisation, never a C-level one (for a confidential
// grade, as G9 · Executive: its lowest grade, as a C-level vacancy is told), its levels merged, under its team (else its
// department), in the organisation's order (departments, each followed by its teams), with HR's choices by key (hidden,
// a public name). The careers page lists the shown ones; HR's Add a CV and the bulk upload every one, hidden ones too.

type Db = Pick<PrismaService, 'department' | 'jobTitle' | 'cvPositionChoice'>;

/** Every position, hidden ones too (cvPositions). */
export async function positionsOf(prisma: Db): Promise<CvPosition[]> {
  const order = [{ sortOrder: 'asc' as const }, { nameEn: 'asc' as const }];
  const [departments, titles, choices] = await Promise.all([
    prisma.department.findMany({ where: { parentId: null }, orderBy: order, select: { id: true, nameEn: true, children: { orderBy: order, select: { id: true, nameEn: true } } } }),
    prisma.jobTitle.findMany({ orderBy: [{ titleEn: 'asc' }, { id: 'asc' }], select: { id: true, titleEn: true, departmentId: true, minGrade: { select: { confidential: true } } } }),
    prisma.cvPositionChoice.findMany({ select: { key: true, hidden: true, publicName: true } }),
  ]);
  const teams = departments.flatMap((d) => [{ id: d.id, name: d.nameEn, departmentName: null }, ...d.children.map((t) => ({ id: t.id, name: t.nameEn, departmentName: d.nameEn }))]);
  return cvPositions(
    teams,
    titles.map((t) => ({ id: t.id, name: t.titleEn, teamId: t.departmentId, cLevel: t.minGrade?.confidential === true })),
    new Map<string, PositionChoice>(choices.map((c) => [c.key, { hidden: c.hidden, publicName: c.publicName }])),
  );
}

/**
 * The position a key names, when it is on the list: the careers page's (`withHidden` false: a shown one) or HR's (hidden
 * ones too); null for an unknown key (a made-up one, one whose job titles changed since, a C-level one) or, on the careers
 * page, a hidden one.
 */
export async function positionOf(prisma: Db, key: string, { withHidden }: { withHidden: boolean }): Promise<CvPosition | null> {
  if (!key || key === OTHER_POSITION || !teamIdOfKey(key)) return null;
  const found = (await positionsOf(prisma)).find((p) => p.key === key);
  return found && (withHidden || !found.hidden) ? found : null;
}
