import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, fromDateOnly, todayInCairo, weekday } from '../src/common/date-only.js';
import { toTimeOfDay } from '../src/common/time-of-day.js';
import { firstDay, lastDay } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { templateWorkbook, zohoLeaveWorkbook, type ZohoLeaveIn } from './fixtures/leave-import.js';
import { createApp, createUser, signIn } from './helpers.js';

// Official duty in the leave import (owner, 26 October 2026, asked "how to apply or import official duty": "Import
// (template + Zoho)"), modelled on its work-from-home rows: the template's Official duty type (and OD, On duty, مأمورية)
// and Zoho's types mapped to "Official duty days" (On Duty by default), each row one approved official duty from its
// first working day to its last, the place "Imported" and the row's notes as its reason; a half day counted whole, said
// so; duplicates and overlaps left out; Zoho's pending carried on pending; Apply, the same file again, Undo and Delete;
// a C-level person's rows the CEO's. Everyone and every number is invented.

const RUN = Date.now().toString(36).toLowerCase();
/** The run as letters only: names compared by their letters (attendance-import.ts nameWords) stay whole. */
const TAG = RUN.replace(/\d/g, (d) => 'abcdefghij'[Number(d)]);
const TODAY = todayInCairo();
const YEAR = Number(TODAY.slice(0, 4));
const M_TEMPLATE = `${YEAR}-04`;
const M_ZOHO = `${YEAR}-01`;
const ZED_ZOHO = String(60_000_000 + (Date.now() % 10_000_000));

interface Row {
  row: number;
  status: string;
  reasons: string[];
  warnings: string[];
  notes: string[];
  employee: { id: string } | null;
  type: { id: string; nameEn: string } | null;
  from: string | null;
  to: string | null;
  days: number | null;
  pending: boolean;
  wfh: boolean;
  od: boolean;
  odDays: string[] | null;
  yours: boolean;
}

interface View {
  id: string;
  sameFile: string | null;
  types: { zohoType: string; typeId: string | null; wfh: boolean; od: boolean; chosen: boolean; defaultOd: boolean; note: string | null }[];
  leaves: Row[];
  counts: Record<string, number>;
  hidden: { rows: number; label: string } | null;
  canApply: boolean;
  undoable: number;
  kept: { leaves: number; adjustments: number; wfhDays: number; od: number };
  undoneAt: string | null;
}

const said = (res: { body: { message: string | string[] } }) => ([] as string[]).concat(res.body.message);
/** A date as the messages show it: DD/MM/YYYY. */
const shown = (ymd: string) => ymd.split('-').reverse().join('/');

describe('Official duty in the leave import (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let ceo: string;
  let superAdmin: string;
  let owner: string; // HR and a Super Admin, as the owner is
  let emailDomainBefore: string | null;
  let g9: { id: string; confidential: boolean };
  let deptId: string;
  let shiftId: string;
  const people: string[] = [];
  const ids: Record<string, string> = {};
  const codes: Record<string, string> = {};
  const imports: string[] = [];
  const holidays = new Set<string>();
  const api = () => request(app.getHttpServer());

  /** A month's working days (Sunday to Thursday) that aren't holidays. */
  const workDays = (month: string) => {
    const out: string[] = [];
    for (let d = firstDay(month); d <= lastDay(month); d = addDays(d, 1)) if (weekday(d) <= 4 && !holidays.has(d)) out.push(d);
    return out;
  };
  /** A Thursday and the Sunday after it, both working days (the Friday and Saturday between rest days), after `after`. */
  const thuToSun = (month: string, after = '0000-01-01') => {
    const days = workDays(month);
    const thu = days.find((d) => d > after && weekday(d) === 4 && days.includes(addDays(d, 3)))!;
    return [thu, addDays(thu, 3)] as const;
  };

  async function person(key: string, name: string, extra: Record<string, unknown> = {}, employment: Record<string, unknown> = {}, session = () => hr) {
    const res = await api().post('/api/employees').set('Cookie', session()).send({ fullNameEn: name, fullNameAr: 'موظف تجريبي', ...extra }).expect(201);
    people.push(res.body.id);
    ids[key] = res.body.id;
    codes[key] = res.body.employeeCode;
    const hired = await api()
      .post(`/api/employees/${res.body.id}/employments`)
      .set('Cookie', session())
      .send({ employmentType: 'full_time', joinDate: `${YEAR - 2}-01-01`, departmentId: deptId, shiftId, ...employment })
      .expect(201);
    return hired.body.employment.id as string;
  }

  const upload = async (file: Buffer, name: string, session = hr) => {
    const res = await api().post('/api/leave/import').set('Cookie', session).attach('file', file, name);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    imports.push(res.body.id);
    return res.body as View;
  };
  const review = async (id: string, session = hr) => (await api().get(`/api/leave/import/${id}`).set('Cookie', session).expect(200)).body as View;
  const apply = (id: string, session = hr) => api().post(`/api/leave/import/${id}/apply`).set('Cookie', session);
  const undo = (id: string, session = hr) => api().post(`/api/leave/import/${id}/undo`).set('Cookie', session);
  const mapType = (id: string, body: object) => api().patch(`/api/leave/import/${id}/types`).set('Cookie', hr).send(body);
  const rowOf = (v: View, row: number) => v.leaves.find((r) => r.row === row)!;
  const odOf = (importId: string) =>
    prisma.odRequest.findMany({ where: { importId }, orderBy: [{ employeeId: 'asc' }, { startDate: 'asc' }], include: { steps: { orderBy: { id: 'asc' } } } });

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hr = await signIn(app, await createUser(prisma, ['hr']));
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    superAdmin = await signIn(app, await createUser(prisma, ['super_admin']));
    owner = await signIn(app, await createUser(prisma, ['hr', 'super_admin']));
    emailDomainBefore = (await api().get('/api/company').set('Cookie', hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: '' }).expect(200);
    deptId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Leave import OD ${TAG}` }).expect(201)).body.id;
    shiftId = (
      await prisma.shift.create({
        data: { code: `LO${RUN}`.slice(0, 20), startTime: toTimeOfDay('09:00'), endTime: toTimeOfDay('18:00'), hoursPerDay: 9, graceMinutes: 0, workingDays: [0, 1, 2, 3, 4] },
        select: { id: true },
      })
    ).id;
    for (const h of await prisma.holiday.findMany({ select: { date: true } })) holidays.add(fromDateOnly(h.date));
    g9 = (await prisma.grade.findFirst({ where: { code: 'G9' }, select: { id: true, confidential: true } }))!;
    await prisma.grade.update({ where: { id: g9.id }, data: { confidential: true } });

    await person('tia', `Tia Template ${TAG}`);
    await person('mia', `Mia Manager ${TAG}`);
    await person('zed', `Zed Zoho ${TAG}`, {}, { managerId: ids.mia });
    await prisma.employee.update({ where: { id: ids.zed }, data: { zohoPeopleId: ZED_ZOHO } });
    // Cleo is C-level: G9, a grade marked confidential (owner, 19 October 2026)
    await person('cleo', `Cleo Chief ${TAG}`, {}, { gradeId: g9.id, departmentId: null }, () => owner);
  });

  afterAll(async () => {
    await prisma.odRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.leaveRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.leaveAdjustment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.wfhRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.leaveImport.deleteMany({ where: { id: { in: imports } } });
    await prisma.leaveBalanceYear.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await prisma.shift.deleteMany({ where: { id: shiftId } });
    await prisma.department.deleteMany({ where: { id: deptId } });
    await prisma.grade.update({ where: { id: g9.id }, data: { confidential: g9.confidential } });
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  describe('the template’s Official duty', () => {
    let importId: string;
    let file: Buffer;
    let picks: Record<string, string>;

    beforeAll(() => {
      const days = workDays(M_TEMPLATE);
      const [thu, sun] = thuToSun(M_TEMPLATE, days[1]);
      const later = days.filter((d) => d > addDays(sun, 2));
      const fri = days.map((d) => addDays(d, 1)).find((d) => weekday(d) === 5 && d > addDays(later[3], 1))!;
      picks = { leave: days[0], thu, sun, half: later[0], next: addDays(sun, 1), fri };
    });

    it('reads its rows as official duty, not leave: one a row, from its first working day to its last; its spellings; a half day whole; the file’s own duplicates and overlaps', async () => {
      file = await templateWorkbook([
        { code: codes.tia, type: 'Annual leave', from: picks.leave, to: picks.leave }, // 2: leave
        { code: codes.tia, type: 'Official duty', from: picks.thu, to: picks.sun, notes: 'Client visit in Alexandria' }, // 3: Thursday to Sunday
        { code: codes.tia, type: 'OD', from: picks.half, to: picks.half, days: 0.5 }, // 4: a half day
        { code: codes.tia, type: 'مأمورية', from: picks.half, to: picks.half }, // 5: the same as row 4
        { code: codes.tia, type: 'On duty', from: picks.sun, to: picks.next }, // 6: meets row 3
        { code: codes.tia, type: 'Official duty', from: `${YEAR}-04-01`, to: `${YEAR}-06-30` }, // 7: longer than one official duty
        { code: codes.tia, type: 'official DUTY', from: picks.fri, to: addDays(picks.fri, 1) }, // 8: a Friday and Saturday
        { code: codes.tia, type: 'Official duty', from: picks.leave, to: picks.leave, notes: 'Shoot' }, // 9: on the day of row 2's leave
        { code: codes.cleo, type: 'Official duty', from: picks.half, to: picks.half }, // 10: C-level
      ]);
      const v = await upload(file, `Template OD ${TAG}.xlsx`);
      importId = v.id;
      expect(rowOf(v, 2)).toMatchObject({ status: 'ready', od: false, type: { nameEn: 'Annual leave' }, days: 1 });
      expect(rowOf(v, 3)).toMatchObject({ status: 'ready', od: true, wfh: false, type: null, days: 2, odDays: [picks.thu, picks.sun], pending: false });
      expect(rowOf(v, 3).notes).toContain(`Left out: ${shown(addDays(picks.thu, 1))} and ${shown(addDays(picks.thu, 2))}, rest days or official holidays here.`);
      expect(rowOf(v, 4)).toMatchObject({ status: 'ready', od: true, days: 1, odDays: [picks.half] });
      expect(rowOf(v, 4).warnings).toEqual([`${shown(picks.half)} is a half day in the file: an official duty imported is a full day here, so it is counted as one.`]);
      expect(rowOf(v, 5)).toMatchObject({ status: 'duplicate', od: true, reasons: ['The same official duty as row 4 of the file.'] });
      expect(rowOf(v, 6)).toMatchObject({ status: 'problem', od: true, reasons: ['Overlaps the official duty in row 3 of the file: put the days right in one of them.'] });
      expect(rowOf(v, 7)).toMatchObject({ status: 'problem', od: true, reasons: ['An official duty row covers at most 31 days in a row: put the rest on a row of its own.'] });
      expect(rowOf(v, 8)).toMatchObject({ status: 'skipped', od: true, reasons: ['0 days: every day of it is a rest day or an official holiday.'] });
      // its day's leave, from the same file, said as history: not refusing it
      expect(rowOf(v, 9)).toMatchObject({ status: 'ready', od: true, odDays: [picks.leave] });
      expect(rowOf(v, 9).warnings).toEqual([`Tia Template ${TAG} has Annual leave on ${shown(picks.leave)} (approved): an official duty can't be on a day of leave.`]);
      // the C-level person's row: hidden from HR
      expect(v.leaves.map((r) => r.row)).not.toContain(10);
      expect(v.hidden).toMatchObject({ rows: 1 });
      expect(await prisma.odRequest.count({ where: { importId } })).toBe(0);
    });

    it('applies: each row one approved official duty, recorded and marked imported, "Imported" its place and the notes its reason; no balance used', async () => {
      const before = (await api().get(`/api/employees/${ids.tia}/leave?year=${YEAR}`).set('Cookie', hr).expect(200)).body.annual.available as number;
      const v = (await apply(importId).expect(200)).body as View;
      expect(v.kept).toEqual({ leaves: 1, adjustments: 0, wfhDays: 0, od: 3 });
      expect([2, 3, 4, 9].map((n) => rowOf(v, n).status)).toEqual(Array(4).fill('applied'));
      expect(rowOf(v, 3)).toMatchObject({ od: true, days: 2, odDays: [picks.thu, picks.sun] });
      const made = await odOf(importId);
      expect(made.map((o) => [fromDateOnly(o.startDate), fromDateOnly(o.endDate), o.status])).toEqual(
        [
          [picks.leave, picks.leave, 'approved'],
          [picks.thu, picks.sun, 'approved'],
          [picks.half, picks.half, 'approved'],
        ].sort((a, b) => a[0].localeCompare(b[0])),
      );
      const thu = made.find((o) => fromDateOnly(o.startDate) === picks.thu)!;
      expect(thu).toMatchObject({ employeeId: ids.tia, fullDay: true, place: 'Imported', reason: 'Client visit in Alexandria', recordedByHr: true, late: false, managerId: null, importId, zohoLinkId: null, warnings: [] });
      expect(thu.steps.map((s) => [s.kind, s.comment])).toEqual([['imported', `Imported from Template OD ${TAG}.xlsx`]]);
      expect(made.find((o) => fromDateOnly(o.startDate) === picks.half)!.reason).toBe(`Imported from Template OD ${TAG}.xlsx`);
      expect(made.find((o) => fromDateOnly(o.startDate) === picks.leave)!.warnings).toHaveLength(1);
      // seen as official duty, imported
      const seen = (await api().get(`/api/official-duty/${thu.id}`).set('Cookie', hr).expect(200)).body;
      expect(seen).toMatchObject({ status: 'approved', recordedByHr: true, imported: true, dutyPlace: 'Imported' });
      expect(await prisma.auditLog.count({ where: { entityType: 'od_request', action: 'import', entityId: { in: made.map((o) => o.id) } } })).toBe(3);
      // the leave takes its day from the annual balance, the official duties nothing
      expect((await api().get(`/api/employees/${ids.tia}/leave?year=${YEAR}`).set('Cookie', hr).expect(200)).body.annual.available).toBe(before - 1);
    });

    it('the CEO sees and applies the C-level person’s row', async () => {
      const v = await review(importId, ceo);
      expect(v.hidden).toBeNull();
      expect(rowOf(v, 10)).toMatchObject({ status: 'ready', od: true, yours: true });
      const after = (await apply(importId, ceo).expect(200)).body as View;
      expect(rowOf(after, 10)).toMatchObject({ status: 'applied' });
      const [cleo] = await prisma.odRequest.findMany({ where: { importId, employeeId: ids.cleo } });
      expect(cleo).toMatchObject({ status: 'approved', place: 'Imported' });
      await api().get(`/api/official-duty/${cleo.id}`).set('Cookie', hr).expect(404);
    });

    it('makes nothing new from the same rows again; Undo removes the official duties, Delete only after', async () => {
      const again = await upload(file, `Template OD ${TAG} again.xlsx`);
      expect(again.sameFile).not.toBeNull();
      expect(again.canApply).toBe(false);
      const other = await upload(await templateWorkbook([{ code: codes.tia, type: 'Official duty', from: picks.thu, to: picks.sun }]), `Template OD ${TAG} other.xlsx`);
      expect(rowOf(other, 2)).toMatchObject({ status: 'duplicate', reasons: [`Already an official duty on ${shown(picks.thu)}–${shown(picks.sun)} (imported from Template OD ${TAG}.xlsx).`] });

      expect(said(await api().delete(`/api/leave/import/${importId}`).set('Cookie', superAdmin).expect(409))[0]).toBe(
        '1 leave and 4 official duties from this import are still in the system. Undo it first, then delete it.',
      );
      const made = (await odOf(importId)).map((o) => o.id);
      // HR undoes HR's: the C-level person's stays, the CEO's to undo
      const v = (await undo(importId).expect(200)).body as View;
      expect(v.kept).toEqual({ leaves: 0, adjustments: 0, wfhDays: 0, od: 1 });
      expect([2, 3, 4, 9].map((n) => rowOf(v, n).status)).toEqual(Array(4).fill('ready'));
      const byCeo = (await undo(importId, ceo).expect(200)).body as View;
      expect(byCeo.kept).toEqual({ leaves: 0, adjustments: 0, wfhDays: 0, od: 0 });
      expect(byCeo.undoneAt).not.toBeNull();
      expect(await prisma.odRequest.count({ where: { id: { in: made } } })).toBe(0);
      expect(await prisma.auditLog.count({ where: { entityType: 'od_request', action: 'delete', entityId: { in: made } } })).toBe(4);
      await api().delete(`/api/leave/import/${importId}`).set('Cookie', superAdmin).expect(204);
    });
  });

  describe('Zoho’s On Duty as official duty days', () => {
    const zed = () => `Zed Zoho ${TAG} ${ZED_ZOHO}`;
    const full = (date: string) => ({ date, duration: 'Full Day' as const });
    const off = (date: string) => ({ date, duration: 'Holiday/Weekend' as const });
    let rows: ZohoLeaveIn[];
    let importId: string;
    let picks: Record<string, string>;

    beforeAll(() => {
      const days = workDays(M_ZOHO);
      const [thu, sun] = thuToSun(M_ZOHO);
      const later = days.filter((d) => d > addDays(sun, 1));
      picks = { thu, sun, pending: later[0], rejected: later[1], mission: later[2], half: later[3] };
      rows = [
        { linkId: `${ZED_ZOHO}01`, employee: zed(), type: 'On Duty', status: 'Approved', days: [full(thu), off(addDays(thu, 1)), off(addDays(thu, 2)), full(sun)], reason: 'Exhibition stand' }, // 2
        { linkId: `${ZED_ZOHO}02`, employee: zed(), type: 'On Duty', status: 'Pending', days: [full(picks.pending)] }, // 3
        { linkId: `${ZED_ZOHO}03`, employee: zed(), type: 'On Duty', status: 'Rejected', days: [full(picks.rejected)] }, // 4
        { linkId: `${ZED_ZOHO}04`, employee: zed(), type: `Mission ${TAG}`, status: 'Approved', days: [full(picks.mission)] }, // 5
        { linkId: `${ZED_ZOHO}05`, employee: zed(), type: 'On Duty', status: 'Approved', days: [{ date: picks.half, duration: 'Half Day', session: '1st Half' }] }, // 6
      ];
    });

    it('maps On Duty to official duty days by default; HR maps another type to them, or skips them', async () => {
      const v = await upload(await zohoLeaveWorkbook(rows), `Leave View OD ${TAG}.xlsx`);
      importId = v.id;
      const typeOf = (t: string) => v.types.find((x) => x.zohoType === t)!;
      expect(typeOf('On Duty')).toMatchObject({ typeId: null, wfh: false, od: true, defaultOd: true, chosen: false, note: 'Imported as approved official duty (not leave): its days count as attended, and no balance is used.' });
      expect(rowOf(v, 2)).toMatchObject({ status: 'ready', od: true, type: null, days: 2, odDays: [picks.thu, picks.sun], employee: { id: ids.zed } });
      expect(rowOf(v, 2).notes).toContain(`Left out: ${shown(addDays(picks.thu, 1))} and ${shown(addDays(picks.thu, 2))}, holidays or weekends in Zoho.`);
      expect(rowOf(v, 3)).toMatchObject({ status: 'ready', od: true, pending: true });
      expect(rowOf(v, 3).notes).toContain('Pending in Zoho People: imported as an official duty request waiting for its decision here, the approver in charge’s, then HR’s.');
      expect(rowOf(v, 4)).toMatchObject({ status: 'skipped', reasons: ['Rejected in Zoho People: not imported.'] });
      expect(rowOf(v, 5)).toMatchObject({ status: 'skipped' });
      expect(rowOf(v, 6)).toMatchObject({ status: 'ready', od: true, days: 1 });
      expect(rowOf(v, 6).warnings).toEqual([`${shown(picks.half)} is a half day in Zoho People: an official duty imported is a full day here.`]);

      let mapped = (await mapType(importId, { zohoType: `Mission ${TAG}`, od: true }).expect(200)).body as View;
      expect(mapped.types.find((t) => t.zohoType === `Mission ${TAG}`)).toMatchObject({ od: true, chosen: true });
      expect(rowOf(mapped, 5)).toMatchObject({ status: 'ready', od: true, odDays: [picks.mission] });
      mapped = (await mapType(importId, { zohoType: 'On Duty', skipped: true }).expect(200)).body as View;
      expect(rowOf(mapped, 2)).toMatchObject({ status: 'skipped', reasons: ['“On Duty” is skipped: choose Official duty days for it above to import these rows.'] });
      mapped = (await mapType(importId, { zohoType: 'On Duty' }).expect(200)).body as View;
      expect(mapped.types.find((t) => t.zohoType === 'On Duty')).toMatchObject({ od: true, chosen: false });
      expect(mapped.counts).toMatchObject({ ready: 4, skipped: 1, pending: 1 });
    });

    it('applies: approved official duties, Zoho’s pending one a request with Zed’s manager, each link id once; Undo removes them', async () => {
      const v = (await apply(importId).expect(200)).body as View;
      expect(v.kept).toEqual({ leaves: 0, adjustments: 0, wfhDays: 0, od: 4 });
      const made = await odOf(importId);
      const of = (start: string) => made.find((o) => fromDateOnly(o.startDate) === start)!;
      expect(of(picks.thu)).toMatchObject({ status: 'approved', reason: 'Exhibition stand', place: 'Imported', recordedByHr: true, zohoLinkId: `${ZED_ZOHO}01`, managerId: null });
      expect(fromDateOnly(of(picks.thu).endDate)).toBe(picks.sun);
      expect(of(picks.thu).steps.map((s) => s.kind)).toEqual(['imported']);
      const pending = of(picks.pending);
      expect(pending).toMatchObject({ status: 'with_manager', managerId: ids.mia, approverRole: 'direct_manager', recordedByHr: false });
      expect(pending.steps.map((s) => [s.kind, s.comment])).toEqual([['submitted', `Imported from Leave View OD ${TAG}.xlsx: pending in Zoho People.`]]);
      expect(of(picks.mission)).toMatchObject({ status: 'approved', zohoLinkId: `${ZED_ZOHO}04` });
      expect(of(picks.half)).toMatchObject({ status: 'approved', fullDay: true });
      expect(await prisma.auditLog.count({ where: { entityType: 'od_request', action: 'import', entityId: { in: made.map((o) => o.id) } } })).toBe(4);

      // another file with the same rows: duplicates by their link id
      const other = await upload(await zohoLeaveWorkbook([rows[0]]), `Leave View OD ${TAG} October.xlsx`);
      expect(rowOf(other, 2)).toMatchObject({ status: 'duplicate', reasons: [`Already an official duty on ${shown(picks.thu)}–${shown(picks.sun)} (imported from Leave View OD ${TAG}.xlsx).`] });

      const undone = (await undo(importId).expect(200)).body as View;
      expect(undone.kept).toEqual({ leaves: 0, adjustments: 0, wfhDays: 0, od: 0 });
      expect(await prisma.odRequest.count({ where: { id: { in: made.map((o) => o.id) } } })).toBe(0);
      expect([2, 3, 5, 6].map((n) => rowOf(undone, n).status)).toEqual(Array(4).fill('ready'));
    });
  });
});
