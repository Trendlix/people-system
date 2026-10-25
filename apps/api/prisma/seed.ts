// Starting data: roles, the two shifts, the grades G1–G9, the contract settings and ending rules, the payroll settings
// and the rates set by law, the law's leave types and the Leave Setup, and the first admin account (Admin, HR and Super
// Admin). Safe to run more than once; existing rows are left as they are.
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { ACCOUNTS_ALLOWANCE, BUILT_IN_LAW_RATES, ENDING_RULE_DEFAULTS, ENDING_RULES, LAW_LEAVE_TYPES, normalTaxTiers, ROLE_LABELS, ROLES } from '@trendlix/shared';
import { PrismaClient, type Prisma } from '../src/generated/prisma/client.js';
import { hashPassword } from '../src/auth/password.js';
import { toTimeOfDay } from '../src/common/time-of-day.js';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const SHIFTS = [
  { code: 'A', start: '09:00', end: '18:00' },
  { code: 'B', start: '10:00', end: '19:00' },
];

// The grading system (owner's table, 14 October 2026); the grades migration adds the same rows to existing databases.
const GRADES = [
  { code: 'G1', rank: 1, levelEn: 'Entry Level', description: 'e.g. Intern / Trainee' },
  { code: 'G2', rank: 2, levelEn: 'Junior', description: 'e.g. Junior Graphic Designer' },
  { code: 'G3', rank: 3, levelEn: 'Intermediate', description: 'e.g. Graphic Designer' },
  { code: 'G4', rank: 4, levelEn: 'Senior', description: 'e.g. Senior Graphic Designer' },
  { code: 'G5', rank: 5, levelEn: 'Team Lead', description: 'e.g. Creative Team Lead' },
  { code: 'G6', rank: 6, levelEn: 'Manager', description: 'e.g. Creative Manager' },
  { code: 'G7', rank: 7, levelEn: 'Head of Department', description: 'e.g. Head of Creative' },
  { code: 'G8', rank: 8, levelEn: 'Director', description: 'e.g. Operations Director' },
  // C-level (owner, 19 October 2026: "make C level Employees details not visible to HR"): only the CEO and the Super
  // Admin see the details of those holding it; the C-level migration marks it on existing databases
  { code: 'G9', rank: 9, levelEn: 'Executive', description: 'e.g. CEO / Managing Director', confidential: true },
];

// Company details as printed on TrendLIX's current contract template. HR can edit them in the app.
const COMPANY = {
  nameEn: 'TrendLIX',
  nameAr: 'تريندليكس',
  activity: 'الدعاية والإعلان وإقامة وتنظيم المعارض وانتاج المحتوي الإليكتروني بصوره المختلفة',
  commercialRegNo: '142423',
  addressAr: '١٣ شارع محمد يوسف القاضي – كلية البنات – مدينة نصر – القاهرة',
  city: 'Cairo',
  emailDomain: 'trendlix.com', // every work email must end in @trendlix.com
};

async function main() {
  await prisma.company.upsert({ where: { id: 1 }, update: {}, create: { id: 1, ...COMPANY } });

  // every role packages/shared lists, Super Admin among them (the super admin migration adds it to existing databases)
  for (const key of ROLES) {
    await prisma.role.upsert({ where: { key }, update: {}, create: { key, name: ROLE_LABELS[key] } });
  }

  for (const g of GRADES) {
    const taken = await prisma.grade.findFirst({ where: { OR: [{ code: g.code }, { rank: g.rank }] } });
    if (!taken) await prisma.grade.create({ data: g });
  }

  // the contracts migration adds the same rows to existing databases (owner's decisions, 15 October 2026)
  await prisma.contractSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1, probationMonths: 3, durationMonths: 12 } });
  for (const [i, key] of ENDING_RULES.entries()) {
    await prisma.endingRule.upsert({ where: { key }, update: {}, create: { key, ...ENDING_RULE_DEFAULTS[key], sortOrder: i + 1 } });
  }
  // the payroll rules, the sheet's to start with (owner's decisions, 16 October 2026); the payroll migration adds the
  // same row to existing databases
  await prisma.payrollSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  // the rates set by law of 2025 and 2026 as packages/shared has them built in (owner's request, 16 October 2026); the
  // law rates migration adds the same rows to existing databases
  for (const { year, taxTiers, ...rates } of BUILT_IN_LAW_RATES) {
    const row = { ...rates, taxTiers: normalTaxTiers(taxTiers) as unknown as Prisma.InputJsonValue };
    await prisma.payrollLawYear.upsert({ where: { year }, update: {}, create: { year, ...row } });
  }

  // the law's leave types and the Leave Setup with the law's numbers (owner, 18 October 2026: "can you apply the leaves
  // according to the law?"; Labour Law 14/2025 Arts. 54–57, 124–133); the leave migration adds the same rows to existing
  // databases
  for (const { key, ...t } of LAW_LEAVE_TYPES) {
    await prisma.leaveType.upsert({ where: { key }, update: {}, create: { key, ...t } });
  }
  await prisma.leaveSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });

  // the per-account allowance (owner, 25 October 2026: "if an employee has an allowance per account, how can we deal
  // with it?"): taxed, not insured; the client accounts migration adds it to existing databases
  const accounts = await prisma.allowanceType.findFirst({ where: { nameEn: { equals: ACCOUNTS_ALLOWANCE.nameEn, mode: 'insensitive' } } });
  if (!accounts) {
    const { _max } = await prisma.allowanceType.aggregate({ _max: { sortOrder: true } });
    await prisma.allowanceType.create({ data: { ...ACCOUNTS_ALLOWANCE, taxable: true, insured: false, basis: 'per_account', sortOrder: (_max.sortOrder ?? 0) + 1 } });
  }

  for (const s of SHIFTS) {
    await prisma.shift.upsert({
      where: { code: s.code },
      update: {},
      create: { code: s.code, startTime: toTimeOfDay(s.start), endTime: toTimeOfDay(s.end) },
    });
  }

  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    console.log('SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set; skipping admin account.');
    return;
  }
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Admin account ${email} already exists; left unchanged.`);
    return;
  }
  // the first account is also the first Super Admin, the only role that deletes records (owner's decision, 15 October
  // 2026); there must always be one
  const roles = await prisma.role.findMany({ where: { key: { in: ['admin', 'hr', 'super_admin'] } }, select: { id: true } });
  await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      roles: { create: roles.map((r) => ({ roleId: r.id })) },
    },
  });
  console.log(`Created admin account ${email} (Admin, HR and Super Admin).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
