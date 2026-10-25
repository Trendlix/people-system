import type { PrismaService } from '../prisma/prisma.service.js';

// "Entering earlier offers" (owner, 25 October 2026: "allow the HR to add for now job offers with a past duedate to enter
// the previous data"): Recruitment Settings' switch, kept on its one row; on for now, also before the row exists. Read by
// the job offers' rules and Recruitment Settings; changed there by HR or a Super Admin (RecruitmentSettingsService).

export async function earlierOffersOn(prisma: Pick<PrismaService, 'recruitmentSettings'>): Promise<boolean> {
  const row = await prisma.recruitmentSettings.findUnique({ where: { id: 1 }, select: { earlierOffers: true } });
  return row?.earlierOffers ?? true;
}
