// Starting data: roles, the two shifts, the grades G1–G9 and the first admin account.
// Safe to run more than once; existing rows are left as they are.
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { hashPassword } from '../src/auth/password.js';
import { toTimeOfDay } from '../src/common/time-of-day.js';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const ROLES = [
  { key: 'employee', name: 'Employee' },
  { key: 'manager', name: 'Direct manager' },
  { key: 'hr', name: 'HR' },
  { key: 'finance', name: 'Finance' },
  { key: 'ceo', name: 'CEO' },
  { key: 'admin', name: 'Admin' },
];

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
  { code: 'G9', rank: 9, levelEn: 'Executive', description: 'e.g. CEO / Managing Director' },
];

// Company details as printed on TrendLIX's current contract template. HR can edit them in the app.
const COMPANY = {
  nameEn: 'TrendLIX',
  nameAr: 'تريندليكس',
  activity: 'الدعاية والإعلان وإقامة وتنظيم المعارض وانتاج المحتوي الإليكتروني بصوره المختلفة',
  commercialRegNo: '142423',
  addressAr: '١٣ شارع محمد يوسف القاضي – كلية البنات – مدينة نصر – القاهرة',
  city: 'Cairo',
};

async function main() {
  await prisma.company.upsert({ where: { id: 1 }, update: {}, create: { id: 1, ...COMPANY } });

  for (const role of ROLES) {
    await prisma.role.upsert({ where: { key: role.key }, update: {}, create: role });
  }

  for (const g of GRADES) {
    const taken = await prisma.grade.findFirst({ where: { OR: [{ code: g.code }, { rank: g.rank }] } });
    if (!taken) await prisma.grade.create({ data: g });
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
  const admin = await prisma.role.findUniqueOrThrow({ where: { key: 'admin' } });
  const hr = await prisma.role.findUniqueOrThrow({ where: { key: 'hr' } });
  await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      roles: { create: [{ roleId: admin.id }, { roleId: hr.id }] },
    },
  });
  console.log(`Created admin account ${email}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
