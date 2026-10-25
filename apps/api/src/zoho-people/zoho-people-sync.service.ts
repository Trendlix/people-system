import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, type OnModuleDestroy } from '@nestjs/common';
import {
  breakMinutesOf,
  cairoDay,
  locksMonth,
  shiftWindowOn,
  spansOfPairs,
  ZOHO_PEOPLE_LOCK_MINUTES,
  ZOHO_PEOPLE_NIGHTLY_TIME,
  ZOHO_PEOPLE_NOT_CONNECTED,
  ZOHO_PEOPLE_RUN_GOING,
  ZOHO_SKIP_REASONS,
  zohoFetchProblems,
  zohoMinutesFor,
  zohoStatusKind,
  type AttendanceDayResult,
  type ZohoPeopleNote,
  type ZohoPeopleView,
  type ZohoPersonRef,
  type ZohoRunKind,
  type ZohoRunStatus,
  type ZohoRunView,
  type ZohoSkipReason,
} from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { AttendanceFillService } from '../attendance/attendance-fill.service.js';
import { AttendanceImportsService } from '../attendance/attendance-imports.service.js';
import { shiftTimesOf } from '../attendance/attendance-days.service.js';
import { CorrectionDaysService } from '../attendance/correction-days.service.js';
import { CalendarsService } from '../calendars/calendars.service.js';
import { addDays, fromDateOnly, todayInCairo, toDateOnly } from '../common/date-only.js';
import { ConfidentialService, type ConfidentialView } from '../employees/confidential.service.js';
import { Prisma, type ZohoPeopleRun } from '../generated/prisma/client.js';
import { userNames } from '../payroll/adjustments/people.js';
import { json } from '../payroll/line-work.js';
import { firstDay } from '../payroll/months.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ZohoPeopleError, type ZohoDay, type ZohoDayRead, type ZohoWho } from './zoho-people-api.js';
import { ZohoPeopleHttp } from './zoho-people-http.js';
import { ZohoPeopleService, type ZohoReadContext } from './zoho-people.service.js';

// Zoho People's check-ins and check-outs fetched (owner, 25 October 2026: "can i fetch checkin and out transactions from
// zoho people through api?"; asked, "Yes, daily + backfill"; then "but can it fetch historical data?"). A run fetches
// each person's days one call a day (Zoho's API has one employee's day a call), in turn with every other call to Zoho
// People (ZohoPeopleHttp: one a second, 60 a minute, under Zoho's 100), in the background, with its progress on the page:
// - who: everyone employed at some time in its days, former employees too, each by the work email they had (Zoho's
//   `emailId`), else by the Zoho employee ID the Excel import remembered (`empId`); a person Zoho People doesn't know by
//   their email is asked by that ID when they have one, else listed "Not found in Zoho People". Only the days within
//   their employments are asked; the others are skipped with why (before their join date, after it ended, between two).
// - the nightly run (ZohoPeopleSchedulerService): at 02:00 Cairo, yesterday for everyone (and the days before it since
//   the last nightly run that finished, a week at most, so a night the server was down is caught up); HR's and a Super
//   Admin's "Fetch from Zoho": up to 12 months up to yesterday, everyone or the people chosen. One run at a time.
// - each day the Zoho import's way (attendance-imports.service.ts): Zoho's day read (zoho-people-api.ts zohoDayOf) is
//   worked out with the person's month by the import's own rules (AttendanceImportsService.months: the shift, the
//   holidays, the approved leave; its hours by its check-in → check-out pairs), and kept as Zoho People's day (source
//   'zoho', one a person and day). Zoho's day kept already (by a run or an Excel import) is matched by its times and left
//   as it is; one Zoho changed since (e.g. a regularisation) is replaced, only that Zoho day: the system's check-ins and
//   the corrections are other days of their own, never touched (a corrected day over it is made again over the new one,
//   as after an import). A month whose payroll is with the CEO, approved or paid (owner, 25 October 2026: "ADD the Zoho
//   punches that are missing, as a record for attendance history"): the days it is missing are added, "for the record,
//   payroll unchanged"; a day there is never replaced (kept, "payroll approved") and those runs never change. The drafts
//   of the months changed are refilled for the people changed (AttendanceFillService, each line audited).
// - Zoho's lock (past its limit, or a day's calls used up): the run waits Zoho's 10 minutes (an hour after six in a row)
//   and goes on, a day at most; Zoho busy or unreachable: tried again after 30 seconds, 2 and 5 minutes, then the run
//   fails; the sign-in refused: the connection needs connecting again and the run fails. A failure says why on the page,
//   and the dashboard tells HR and the Super Admin of a nightly one (note).
// - its plan and where it got to are kept with it, so after the API restarts it goes on (the scheduler finds it); it can
//   be cancelled. Each run in the audit log (started, cancelled, how it ended with its counts) and each person's month it
//   kept days in (its counts).

export const ZOHO_PEOPLE_RUN_ENTITY = 'zoho_people_run';

/** The advisory lock a run is started under: one at a time, whichever process starts it. */
const RUN_LOCK = 'people-system zoho people run';
/** A run whose heartbeat is older than this has no process: the scheduler takes it on. */
export const ZOHO_RUN_STALE_MS = 2 * 60_000;
/** A wait is slept in slices this long: the heartbeat kept and a cancel seen. */
const SLICE_MS = 30_000;
/** The longest a run waits for Zoho in all: a day and an hour. */
const MOST_WAITING_MS = 25 * 3_600_000;
/** Zoho busy or unreachable: tried again after these waits, then the run fails. */
const RETRY_WAITS_MS = [30_000, 120_000, 300_000];
const ERRORS_KEPT = 50;
const RUNS_SHOWN = 10;

/** A person of a run's plan: who, how Zoho is asked for them, and their days by employment. */
interface PlanItem {
  employeeId: string;
  code: string;
  email: string | null;
  zohoId: string | null;
  ranges: { from: string; to: string; employmentId: string }[];
}

/** Where a run got to: the person and the month next, and the calls done until then. */
interface Cursor {
  item: number;
  month: string | null;
  callsDone: number;
}

/** What a run holds while it goes, written at each month's end. */
interface RunState {
  callsDone: number;
  skipped: Partial<Record<ZohoSkipReason, number>>;
  notFound: string[];
  errors: string[];
}

class RunCancelled extends Error {}
class RunStopped extends Error {}

const round2 = (n: number) => Math.round(n * 100) / 100;
const minuteOf = (v: Date | string | null | undefined) => (v ? Math.floor(new Date(v).getTime() / 60_000) : null);

/** The months of a person's ranges, each with its days, by employment, in order. */
function chunksOf(ranges: PlanItem['ranges']): { month: string; employmentId: string; dates: string[] }[] {
  const out: { month: string; employmentId: string; dates: string[] }[] = [];
  const seen = new Set<string>();
  for (const r of ranges) {
    for (let d = r.from; d <= r.to; d = addDays(d, 1)) {
      if (seen.has(d)) continue;
      seen.add(d);
      const month = d.slice(0, 7);
      const last = out.at(-1);
      if (last && last.month === month && last.employmentId === r.employmentId) last.dates.push(d);
      else out.push({ month, employmentId: r.employmentId, dates: [d] });
    }
  }
  return out.sort((a, b) => a.dates[0].localeCompare(b.dates[0]));
}

const CAIRO_TIME = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

@Injectable()
export class ZohoPeopleSyncService implements OnModuleDestroy {
  private readonly logger = new Logger('ZohoPeopleSync');
  private readonly jobs = new Map<string, Promise<void>>();
  private stopping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly zoho: ZohoPeopleService,
    private readonly http: ZohoPeopleHttp,
    private readonly imports: AttendanceImportsService,
    private readonly corrections: CorrectionDaysService,
    private readonly fill: AttendanceFillService,
    private readonly confidential: ConfidentialService,
    private readonly calendars: CalendarsService,
  ) {}

  onModuleDestroy(): void {
    // a run going is left as it is: the next process goes on with it from where it got to
    this.stopping = true;
  }

  // ---------- starting ----------

  /**
   * Each person's plan for days `from` to `to` (YYYY-MM-DD): everyone employed at some time in them (former employees
   * too), or the people chosen; their days within their employments, by employment; the others skipped with why. A
   * person with neither a work email nor a Zoho employee ID is planned (and listed) without calls.
   */
  private async plan(from: string, to: string, ids: readonly string[] | null) {
    const employees = await this.prisma.employee.findMany({
      where: ids ? { id: { in: [...ids] } } : { employments: { some: { joinDate: { lte: toDateOnly(to) }, OR: [{ endDate: null }, { endDate: { gte: toDateOnly(from) } }] } } },
      orderBy: [{ employeeCode: 'asc' }],
      select: { id: true, employeeCode: true, workEmail: true, zohoPeopleId: true, employments: { select: { id: true, joinDate: true, endDate: true }, orderBy: { joinDate: 'asc' } } },
    });
    const items: PlanItem[] = [];
    const skipped: Partial<Record<ZohoSkipReason, number>> = {};
    const skip = (reason: ZohoSkipReason, n = 1) => {
      if (n > 0) skipped[reason] = (skipped[reason] ?? 0) + n;
    };
    let calls = 0;
    let people = 0;
    for (const e of employees) {
      const jobs = e.employments.map((j) => ({ id: j.id, from: fromDateOnly(j.joinDate), to: j.endDate ? fromDateOnly(j.endDate) : null }));
      const ranges = jobs
        .map((j) => ({ from: j.from > from ? j.from : from, to: j.to !== null && j.to < to ? j.to : to, employmentId: j.id }))
        .filter((r) => r.from <= r.to);
      const covered = new Set<string>();
      for (const r of ranges) for (let d = r.from; d <= r.to; d = addDays(d, 1)) covered.add(d);
      const firstJoin = jobs[0]?.from ?? null;
      const lastEnd = jobs.length && jobs.every((j) => j.to !== null) ? jobs.map((j) => j.to!).sort().at(-1)! : null;
      for (let d = from; d <= to; d = addDays(d, 1)) {
        if (covered.has(d)) continue;
        skip(!firstJoin || d < firstJoin ? 'before_join' : lastEnd && d > lastEnd ? 'after_end' : 'between_employments');
      }
      const email = e.workEmail?.trim().toLowerCase() || null;
      const zohoId = e.zohoPeopleId?.trim() || null;
      if (!covered.size) continue;
      items.push({ employeeId: e.id, code: e.employeeCode, email, zohoId, ranges });
      if (!email && !zohoId) skip('no_work_email', covered.size);
      else {
        calls += covered.size;
        people++;
      }
    }
    return { items, skipped, calls, people };
  }

  /** A run made, under the run lock: refused (409) while another is going; the nightly one once a day. */
  private async create(data: { kind: ZohoRunKind; from: string; to: string; employeeIds: string[]; startedById: string | null; nightlyFor: string | null }): Promise<ZohoPeopleRun> {
    const plan = await this.plan(data.from, data.to, data.employeeIds.length ? data.employeeIds : null);
    const made = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${RUN_LOCK}))::text AS locked`;
      if (await tx.zohoPeopleRun.count({ where: { status: 'running' } })) throw new ConflictException(ZOHO_PEOPLE_RUN_GOING);
      if (data.nightlyFor && (await tx.zohoPeopleRun.count({ where: { nightlyFor: toDateOnly(data.nightlyFor) } }))) return null;
      return tx.zohoPeopleRun.create({
        data: {
          kind: data.kind,
          nightlyFor: data.nightlyFor ? toDateOnly(data.nightlyFor) : null,
          fromDate: toDateOnly(data.from),
          toDate: toDateOnly(data.to),
          employeeIds: data.employeeIds,
          startedById: data.startedById,
          plan: json(plan.items),
          cursor: json({ item: 0, month: null, callsDone: 0 } satisfies Cursor),
          peopleTotal: plan.people,
          callsTotal: plan.calls,
          skipped: json(plan.skipped),
        },
      });
    });
    if (!made) throw new ConflictException('Last night’s fetch from Zoho People was made already.');
    await this.audit.record({
      userId: data.startedById,
      action: 'create',
      entityType: ZOHO_PEOPLE_RUN_ENTITY,
      entityId: made.id,
      diff: { kind: data.kind, from: data.from, to: data.to, everyone: !data.employeeIds.length, ...(data.employeeIds.length && { chosen: data.employeeIds.length }), people: plan.people, calls: plan.calls },
    });
    this.launch(made.id);
    return made;
  }

  /**
   * POST /zoho-people/runs: HR's and a Super Admin's "Fetch from Zoho" (owner, 25 October 2026): up to 12 months up to
   * yesterday, everyone or the people chosen (a C-level person only by those who see them), Zoho People connected.
   */
  async startFetch(dto: { from: string; to: string; employeeIds?: string[] | null }, user: SessionUser): Promise<ZohoRunView> {
    this.zoho.assertFetcher(user);
    const c = await this.zoho.connection();
    if (!c) throw new BadRequestException([ZOHO_PEOPLE_NOT_CONNECTED]);
    if (c.status !== 'connected') throw new BadRequestException([c.problem ?? 'Zoho People’s connection needs connecting again: a Super Admin connects it on Organization → Zoho People.']);
    const problems = zohoFetchProblems(dto, todayInCairo());
    if (problems.length) throw new BadRequestException(problems);
    const ids = [...new Set(dto.employeeIds ?? [])];
    if (ids.length) {
      const confidential = await this.confidential.view(user);
      const found = await this.prisma.employee.count({ where: { id: { in: ids } } });
      if (found !== ids.length || ids.some((id) => confidential.hidden.has(id))) throw new BadRequestException(['Employee not found. Choose the people from the list.']);
    }
    const run = await this.create({ kind: 'fetch', from: dto.from, to: dto.to, employeeIds: ids, startedById: user.id, nightlyFor: null });
    return this.runView(run.id, user);
  }

  /**
   * The nightly run, when it is due (ZohoPeopleSchedulerService, every minute; the tests call it with a moment): from
   * 02:00 Cairo, once a day, yesterday for everyone, from the day after the last nightly run that finished (a week at
   * most). Nothing while Zoho People isn't connected or another run is going (it is tried again a minute later). Null
   * when it didn't start one.
   */
  async nightlyIfDue(now: Date = new Date()): Promise<string | null> {
    if (CAIRO_TIME.format(now) < ZOHO_PEOPLE_NIGHTLY_TIME) return null;
    const yesterday = addDays(cairoDay(now), -1);
    if (await this.prisma.zohoPeopleRun.count({ where: { nightlyFor: toDateOnly(yesterday) } })) return null;
    const c = await this.zoho.connection();
    if (!c || c.status !== 'connected') return null;
    if (await this.prisma.zohoPeopleRun.count({ where: { status: 'running' } })) return null;
    const last = await this.prisma.zohoPeopleRun.findFirst({ where: { kind: 'nightly', status: 'finished', nightlyFor: { lt: toDateOnly(yesterday) } }, orderBy: { nightlyFor: 'desc' }, select: { nightlyFor: true } });
    const weekAgo = addDays(yesterday, -6);
    let from = last?.nightlyFor ? addDays(fromDateOnly(last.nightlyFor), 1) : yesterday;
    if (from < weekAgo) from = weekAgo;
    if (from > yesterday) from = yesterday;
    try {
      return (await this.create({ kind: 'nightly', from, to: yesterday, employeeIds: [], startedById: null, nightlyFor: yesterday })).id;
    } catch (err) {
      if (err instanceof ConflictException) return null;
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null;
      throw err;
    }
  }

  /** The runs going with no process (the API restarted): taken on again from where they got to. */
  async resumeStale(now: Date = new Date()): Promise<string[]> {
    const before = new Date(now.getTime() - ZOHO_RUN_STALE_MS);
    const runs = await this.prisma.zohoPeopleRun.findMany({ where: { status: 'running', heartbeatAt: { lt: before } }, select: { id: true } });
    const taken: string[] = [];
    for (const r of runs) {
      if (this.jobs.has(r.id)) continue;
      const { count } = await this.prisma.zohoPeopleRun.updateMany({ where: { id: r.id, status: 'running', heartbeatAt: { lt: before } }, data: { heartbeatAt: new Date() } });
      if (!count) continue;
      this.launch(r.id);
      taken.push(r.id);
    }
    return taken;
  }

  /**
   * POST /zoho-people/runs/:id/cancel: the run stops before its next call (a run with no process stops at once); what it
   * kept stays. HR and a Super Admin; audited.
   */
  async cancel(id: string, user: SessionUser): Promise<ZohoRunView> {
    this.zoho.assertFetcher(user);
    const run = await this.prisma.zohoPeopleRun.findUnique({ where: { id }, select: { id: true, status: true, heartbeatAt: true } });
    if (!run) throw new NotFoundException('This fetch from Zoho People was not found.');
    if (run.status !== 'running') throw new ConflictException('This fetch from Zoho People isn’t going any more.');
    await this.prisma.zohoPeopleRun.update({ where: { id }, data: { cancelRequestedAt: new Date(), cancelledById: user.id } });
    await this.audit.record({ userId: user.id, action: 'cancel', entityType: ZOHO_PEOPLE_RUN_ENTITY, entityId: id });
    if (!this.jobs.has(id) && run.heartbeatAt.getTime() < Date.now() - ZOHO_RUN_STALE_MS) await this.end(id, 'cancelled', null);
    return this.runView(id, user);
  }

  /** The run's work in the background, one at a time a run in this process. */
  private launch(id: string): void {
    if (this.jobs.has(id)) return;
    const job = this.process(id)
      .catch((err: unknown) => this.logger.error(`A fetch from Zoho People stopped: ${(err as Error).message}`))
      .finally(() => this.jobs.delete(id));
    this.jobs.set(id, job);
  }

  /** Waits for a run's work in this process to end (the tests). */
  async whenDone(id: string): Promise<void> {
    await this.jobs.get(id);
  }

  // ---------- the work ----------

  private async process(id: string): Promise<void> {
    const run = await this.prisma.zohoPeopleRun.findUnique({ where: { id } });
    if (!run || run.status !== 'running') return;
    const plan = run.plan as unknown as PlanItem[];
    const cursor = (run.cursor as unknown as Cursor | null) ?? { item: 0, month: null, callsDone: 0 };
    const state: RunState = {
      callsDone: cursor.callsDone,
      skipped: { ...(run.skipped as Partial<Record<ZohoSkipReason, number>>) },
      notFound: [...run.notFound],
      errors: [...(run.errors as string[])],
    };
    try {
      const ctx = await this.zoho.readContext();
      for (let i = cursor.item; i < plan.length; i++) {
        const item = plan[i];
        if (item.email || item.zohoId) await this.person(run, item, i, i === cursor.item ? cursor.month : null, ctx, state);
        await this.prisma.zohoPeopleRun.update({
          where: { id },
          data: { peopleDone: { increment: item.email || item.zohoId ? 1 : 0 }, cursor: json({ item: i + 1, month: null, callsDone: state.callsDone } satisfies Cursor), heartbeatAt: new Date() },
        });
      }
      await this.end(id, 'finished', null, state);
    } catch (err) {
      if (err instanceof RunStopped) return;
      if (err instanceof RunCancelled) {
        await this.end(id, 'cancelled', null, state);
        return;
      }
      const problem = err instanceof ZohoPeopleError ? err.message : 'Something went wrong on the server: the fetch stopped. Fetch the rest again.';
      if (!(err instanceof ZohoPeopleError)) this.logger.error(`A fetch from Zoho People failed: ${(err as Error).message}`);
      await this.end(id, 'failed', problem, state);
    }
  }

  /** A run ended: finished, cancelled or failed (with why), its counts kept and audited. */
  private async end(id: string, status: ZohoRunStatus, problem: string | null, state?: RunState): Promise<void> {
    const run = await this.prisma.zohoPeopleRun.update({
      where: { id },
      data: {
        status,
        finishedAt: new Date(),
        waitingUntil: null,
        problem,
        ...(state && { callsDone: state.callsDone, skipped: json(state.skipped), notFound: state.notFound, errors: json(state.errors.slice(-ERRORS_KEPT)) }),
      },
    });
    const action = status === 'finished' ? 'finish' : status === 'cancelled' ? 'cancelled' : 'fail';
    await this.audit.record({
      userId: null,
      action,
      entityType: ZOHO_PEOPLE_RUN_ENTITY,
      entityId: id,
      diff: {
        kind: run.kind,
        from: fromDateOnly(run.fromDate),
        to: fromDateOnly(run.toDate),
        people: run.peopleDone,
        calls: run.callsDone,
        daysAdded: run.daysAdded,
        punchesAdded: run.punchesAdded,
        daysReplaced: run.daysReplaced,
        daysUnchanged: run.daysUnchanged,
        daysRecorded: run.daysRecorded,
        linesRefilled: run.linesRefilled,
        notFound: run.notFound.length,
        ...(problem && { problem }),
      },
    });
  }

  /** A heartbeat with the progress; throws when the run was cancelled, or the API is stopping. */
  private async beat(id: string, state: RunState): Promise<void> {
    if (this.stopping) throw new RunStopped();
    const r = await this.prisma.zohoPeopleRun.update({ where: { id }, data: { callsDone: state.callsDone, heartbeatAt: new Date() }, select: { cancelRequestedAt: true, status: true } });
    if (r.cancelRequestedAt || r.status !== 'running') throw new RunCancelled();
  }

  /** Waits `ms` on Zoho's clock, said on the page (waitingUntil), in slices: the heartbeat kept, a cancel seen. */
  private async wait(id: string, ms: number, state: RunState): Promise<void> {
    const clock = this.http.clock;
    const until = clock.now() + ms;
    this.http.holdUntil(until);
    await this.prisma.zohoPeopleRun.update({ where: { id }, data: { waitingUntil: new Date(Date.now() + ms) } });
    while (clock.now() < until) {
      await clock.sleep(Math.min(SLICE_MS, until - clock.now()));
      await this.beat(id, state);
    }
    await this.prisma.zohoPeopleRun.update({ where: { id }, data: { waitingUntil: null } });
  }

  /**
   * One day asked of Zoho, waiting out its lock (its 10 minutes, an hour after six in a row, a day at most) and trying
   * again when it is busy or unreachable (30 seconds, 2 and 5 minutes); someone not found or not permitted said as such.
   */
  private async ask(id: string, who: ZohoWho, date: string, ctx: ZohoReadContext, state: RunState): Promise<ZohoDayRead | { kind: 'not_found' } | { kind: 'not_permitted'; message: string }> {
    let locks = 0;
    let retries = 0;
    let waited = 0;
    for (;;) {
      await this.beat(id, state);
      try {
        return await this.zoho.day(who, date, ctx);
      } catch (err) {
        if (!(err instanceof ZohoPeopleError)) throw err;
        if (err.kind === 'not_found') return { kind: 'not_found' };
        if (err.kind === 'not_permitted') return { kind: 'not_permitted', message: err.message };
        if (err.kind === 'refused') return { kind: 'unreadable', message: err.message };
        if (err.kind === 'lock') {
          locks++;
          const ms = (locks <= 6 ? ZOHO_PEOPLE_LOCK_MINUTES : 60) * 60_000 + 30_000;
          waited += ms;
          if (waited > MOST_WAITING_MS) throw new ZohoPeopleError('lock', 'Zoho People kept asking to wait for a day (its daily calls used up): the fetch stopped. Fetch the rest again tomorrow.', err.code);
          await this.wait(id, ms, state);
          continue;
        }
        if ((err.kind === 'busy' || err.kind === 'unreachable') && retries < RETRY_WAITS_MS.length) {
          await this.wait(id, RETRY_WAITS_MS[retries++], state);
          continue;
        }
        if (err.kind === 'busy' || err.kind === 'unreachable') throw new ZohoPeopleError(err.kind, `${err.message} It didn’t answer for a while, so the fetch stopped: fetch the rest again later.`, err.code);
        throw err;
      }
    }
  }

  /** A person's days of a run: asked a day at a time, kept a month at a time, from `fromMonth` on (a run going on). */
  private async person(run: ZohoPeopleRun, item: PlanItem, index: number, fromMonth: string | null, ctx: ZohoReadContext, state: RunState): Promise<void> {
    let who: ZohoWho = item.email ? { emailId: item.email } : { empId: item.zohoId! };
    let byIdTried = !item.email;
    let gone = false;
    let refused = false;
    const skip = (reason: ZohoSkipReason) => {
      state.skipped[reason] = (state.skipped[reason] ?? 0) + 1;
    };
    const error = (date: string, message: string) => {
      state.errors.push(`${item.code} ${date}: ${message}`);
      if (state.errors.length > ERRORS_KEPT) state.errors.splice(0, state.errors.length - ERRORS_KEPT);
    };
    const chunks = chunksOf(item.ranges);
    for (let c = 0; c < chunks.length; c++) {
      const chunk = chunks[c];
      if (fromMonth && chunk.month < fromMonth) continue;
      const fetched: ZohoDay[] = [];
      for (const date of chunk.dates) {
        if (gone || refused) {
          skip(gone ? 'not_found' : 'not_permitted');
          state.callsDone++;
          continue;
        }
        let read = await this.ask(run.id, who, date, ctx, state);
        if (read.kind === 'not_found' && !byIdTried && item.zohoId) {
          // not known by their work email: by the Zoho employee ID the Excel import remembered
          byIdTried = true;
          who = { empId: item.zohoId };
          read = await this.ask(run.id, who, date, ctx, state);
        }
        state.callsDone++;
        if (read.kind === 'not_found') {
          gone = true;
          if (!state.notFound.includes(item.employeeId)) state.notFound.push(item.employeeId);
          skip('not_found');
        } else if (read.kind === 'not_permitted') {
          refused = true;
          error(date, read.message);
          skip('not_permitted');
        } else if (read.kind === 'empty') skip('nothing_in_zoho');
        else if (read.kind === 'unreadable') {
          error(date, read.message);
          skip('unreadable');
        } else fetched.push(read.day);
      }
      const kept = await this.keep(run, item, chunk.month, chunk.employmentId, fetched, state);
      const next = chunks[c + 1]?.month ?? null;
      await this.prisma.zohoPeopleRun.update({
        where: { id: run.id },
        data: {
          daysAdded: { increment: kept.added },
          punchesAdded: { increment: kept.punches },
          daysReplaced: { increment: kept.replaced },
          daysUnchanged: { increment: kept.unchanged },
          daysRecorded: { increment: kept.recorded },
          linesRefilled: { increment: kept.lines },
          skipped: json(state.skipped),
          notFound: state.notFound,
          errors: json(state.errors),
          callsDone: state.callsDone,
          heartbeatAt: new Date(),
          cursor: json({ item: next ? index : index + 1, month: next, callsDone: state.callsDone } satisfies Cursor),
        },
      });
    }
  }

  /**
   * A person's month of days fetched, kept the Zoho import's way (the brief: "through the same path as the existing Zoho
   * Excel import"): worked out by the import's rules for their employment (AttendanceImportsService.months), each kept as
   * Zoho People's day: added when there is none; left when Zoho's day kept already has the same times (by a run or an
   * import: never twice); replaced when Zoho changed it, only that Zoho day; in a month whose payroll is with the CEO,
   * approved or paid only added (for the record), never replaced. Then, outside such a month, the corrected days over the
   * days changed made again and the month's draft refilled for them.
   */
  private async keep(run: ZohoPeopleRun, item: PlanItem, month: string, employmentId: string, fetched: ZohoDay[], state: RunState) {
    const out = { added: 0, punches: 0, replaced: 0, unchanged: 0, recorded: 0, lines: 0 };
    if (!fetched.length) return out;
    const worked = (await this.imports.months(month, [{ employeeId: item.employeeId, employmentId, days: fetched.map((f) => f.day) }])).get(item.employeeId);
    if (!worked?.days.length) return out;
    const employment = await this.prisma.employment.findUnique({ where: { id: employmentId }, select: { shift: { select: { startTime: true, endTime: true, hoursPerDay: true, graceMinutes: true, countUntil: true, workingDays: true } } } });
    const shift = employment?.shift ? shiftTimesOf(employment.shift) : null;
    const byDate = new Map(fetched.map((f) => [f.day.date, f]));
    const at = new Date();
    const changed: string[] = [];
    const lockedMonth = { locked: false };
    await this.prisma.$transaction(
      async (tx) => {
        // their row locked as a press locks it (check-in.service.ts), so no import or press is lost meanwhile
        await tx.$queryRaw`SELECT 1 FROM employees WHERE id = ${item.employeeId}::uuid FOR UPDATE`;
        const payroll = await tx.payrollRun.findUnique({ where: { month: toDateOnly(firstDay(month)) }, select: { status: true } });
        lockedMonth.locked = !!payroll && locksMonth(payroll.status);
        const locked = lockedMonth.locked;
        const kept = await tx.attendanceDay.findMany({
          where: { employeeId: item.employeeId, source: 'zoho', date: { in: worked.days.map((d) => toDateOnly(d.date)) } },
          select: { id: true, date: true, checkIn: true, checkOut: true, zohoStatus: true, pairs: true, openAt: true },
        });
        const keptOn = new Map(kept.map((k) => [fromDateOnly(k.date), k]));
        for (const d of worked.days) {
          const f = byDate.get(d.date)!;
          const data = this.dayData(d, f, shift, run, at);
          const was = keptOn.get(d.date);
          if (!was) {
            await tx.attendanceDay.create({ data: { employeeId: item.employeeId, date: toDateOnly(d.date), source: 'zoho', ...data } });
            if (locked) out.recorded++;
            else out.added++;
            out.punches += f.punches;
            changed.push(d.date);
          } else if (sameZohoDay(was, d, f)) out.unchanged++;
          else if (locked) state.skipped.payroll_approved = (state.skipped.payroll_approved ?? 0) + 1;
          else {
            await tx.attendanceDay.update({ where: { id: was.id }, data });
            out.replaced++;
            changed.push(d.date);
          }
        }
      },
      { timeout: 60_000, maxWait: 15_000 },
    );
    const locked = lockedMonth.locked;
    if (!changed.length) return out;
    await this.audit.record({
      userId: run.startedById,
      action: 'zoho_fetch',
      entityType: 'attendance_day',
      entityId: null,
      diff: { runId: run.id, month, employeeCode: item.code, added: out.added, replaced: out.replaced, recorded: out.recorded, punches: out.punches, ...(locked ? { payrollUnchanged: true } : {}) },
    });
    if (locked) return out;
    // as after an import: the corrected days over them made again, the month's draft refilled for them
    for (const date of changed) await this.corrections.rebuildIfCorrected(item.employeeId, date, null);
    const filled = await this.fill.fillMonth(item.employeeId, month, null);
    out.lines = filled.filled + filled.cleared + filled.leaveCounted;
    return out;
  }

  /** A day as AttendanceDay keeps Zoho People's fetched one: the import's day with its pairs, break and open check-in. */
  private dayData(d: AttendanceDayResult, f: ZohoDay, shift: ReturnType<typeof shiftTimesOf> | null, run: ZohoPeopleRun, at: Date) {
    const pairs = d.pairs ?? null;
    const window = shift ? shiftWindowOn(d.date, shift) : null;
    return {
      checkIn: d.checkIn ? new Date(d.checkIn) : null,
      checkOut: d.checkOut ? new Date(d.checkOut) : null,
      status: d.status,
      zohoStatus: d.zohoStatus,
      place: d.place,
      permissionHours: d.permissionHours > 0 ? d.permissionHours : null,
      hoursCounted: round2(d.hoursCounted),
      pairs: pairs ? json(pairs) : Prisma.DbNull,
      breakMinutes: pairs?.length ? breakMinutesOf(spansOfPairs(pairs), f.openAt ? Date.parse(f.openAt) : null, window) : null,
      openAt: f.openAt ? new Date(f.openAt) : null,
      flags: [],
      importId: null,
      importedById: run.startedById,
      importedAt: at,
      zohoRunId: run.id,
    };
  }

  // ---------- the views ----------

  /** The people of runs as the page names them; the C-level people hidden from the caller left out (counted). */
  private async refs(ids: readonly string[], plan: readonly PlanItem[]): Promise<Map<string, ZohoPersonRef>> {
    const out = new Map<string, ZohoPersonRef>();
    if (!ids.length) return out;
    const today = toDateOnly(todayInCairo());
    const rows = await this.prisma.employee.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: { id: true, fullNameEn: true, employeeCode: true, workEmail: true, employments: { where: { joinDate: { lte: today }, OR: [{ endDate: null }, { endDate: { gte: today } }] }, select: { id: true } } },
    });
    for (const r of rows) {
      const planned = plan.find((p) => p.employeeId === r.id);
      out.set(r.id, { employeeId: r.id, name: r.fullNameEn, employeeCode: r.employeeCode, email: planned?.email ?? r.workEmail ?? null, former: !r.employments.length });
    }
    return out;
  }

  private async runViews(runs: ZohoPeopleRun[], confidential: ConfidentialView): Promise<ZohoRunView[]> {
    const ids = runs.flatMap((r) => [...r.notFound, ...(r.plan as unknown as PlanItem[]).filter((p) => !p.email && !p.zohoId).map((p) => p.employeeId)]);
    const refs = await this.refs(ids, runs.flatMap((r) => r.plan as unknown as PlanItem[]));
    const names = await userNames(this.prisma, await this.prisma.user.findMany({ where: { id: { in: runs.map((r) => r.startedById).filter((x): x is string => !!x) } }, select: { id: true, email: true } }));
    return runs.map((r) => {
      const plan = r.plan as unknown as PlanItem[];
      let hidden = 0;
      const shown = (list: string[]) =>
        list.flatMap((id) => {
          if (confidential.hidden.has(id)) {
            hidden++;
            return [];
          }
          const ref = refs.get(id);
          return ref ? [ref] : [];
        });
      const notFound = shown(r.notFound);
      const noWorkEmail = shown(plan.filter((p) => !p.email && !p.zohoId).map((p) => p.employeeId));
      const skipped = r.skipped as Partial<Record<ZohoSkipReason, number>>;
      const left = Math.max(0, r.callsTotal - r.callsDone);
      const waitLeft = r.waitingUntil ? Math.max(0, Math.ceil((r.waitingUntil.getTime() - Date.now()) / 60_000)) : 0;
      return {
        id: r.id,
        kind: r.kind as ZohoRunKind,
        from: fromDateOnly(r.fromDate),
        to: fromDateOnly(r.toDate),
        everyone: !r.employeeIds.length,
        chosen: r.employeeIds.length,
        status: r.status as ZohoRunStatus,
        startedAt: r.startedAt.toISOString(),
        finishedAt: r.finishedAt?.toISOString() ?? null,
        startedBy: r.startedById ? (names.get(r.startedById) ?? null) : null,
        cancelRequested: !!r.cancelRequestedAt,
        waitingUntil: r.status === 'running' ? (r.waitingUntil?.toISOString() ?? null) : null,
        minutesLeft: r.status === 'running' ? zohoMinutesFor(left) + waitLeft : null,
        counts: {
          people: r.peopleTotal,
          peopleDone: r.peopleDone,
          calls: r.callsTotal,
          callsDone: Math.min(r.callsDone, r.callsTotal),
          daysAdded: r.daysAdded,
          punchesAdded: r.punchesAdded,
          daysReplaced: r.daysReplaced,
          daysUnchanged: r.daysUnchanged,
          daysRecorded: r.daysRecorded,
          linesRefilled: r.linesRefilled,
        },
        skipped: ZOHO_SKIP_REASONS.filter((k) => (skipped[k] ?? 0) > 0).map((reason) => ({ reason, days: skipped[reason]! })),
        notFound,
        noWorkEmail,
        hidden,
        errors: (r.errors as string[]).slice(-20),
        problem: r.problem,
      };
    });
  }

  /** GET /zoho-people/runs/:id: a run, for its progress. */
  async runView(id: string, user: SessionUser): Promise<ZohoRunView> {
    this.zoho.assertFetcher(user);
    const run = await this.prisma.zohoPeopleRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException('This fetch from Zoho People was not found.');
    return (await this.runViews([run], await this.confidential.view(user)))[0];
  }

  /**
   * GET /zoho-people: the page. The shared Zoho app (a Super Admin's), the connection, the run going and the last ones,
   * those not found in Zoho People by the latest run that asked for them, the nightly run's last, and those employed now
   * (for the estimate). HR and a Super Admin.
   */
  async view(user: SessionUser): Promise<ZohoPeopleView> {
    this.zoho.assertFetcher(user);
    const manages = this.zoho.manages(user);
    const today = toDateOnly(todayInCairo());
    const [c, runs, app, people, confidential, lastNightly] = await Promise.all([
      this.zoho.connection(),
      this.prisma.zohoPeopleRun.findMany({ orderBy: { startedAt: 'desc' }, take: 30 }),
      manages ? this.calendars.sharedZohoApp() : Promise.resolve(null),
      this.prisma.employee.count({ where: { workEmail: { not: null }, employments: { some: { joinDate: { lte: today }, OR: [{ endDate: null }, { endDate: { gte: today } }] } } } }),
      this.confidential.view(user),
      this.prisma.zohoPeopleRun.findFirst({ where: { kind: 'nightly' }, orderBy: { nightlyFor: 'desc' } }),
    ]);
    const views = await this.runViews(runs.slice(0, RUNS_SHOWN), confidential);
    // not found by the latest run that asked for them: a later one that found them clears them
    const decided = new Set<string>();
    const notFoundIds: string[] = [];
    for (const r of runs) {
      const plan = r.plan as unknown as PlanItem[];
      const reached = r.status === 'finished' ? plan.length : r.status === 'running' ? -1 : ((r.cursor as unknown as Cursor | null)?.item ?? 0);
      plan.forEach((p, i) => {
        if (decided.has(p.employeeId) || !(p.email || p.zohoId) || i >= reached) return;
        decided.add(p.employeeId);
        if (r.notFound.includes(p.employeeId)) notFoundIds.push(p.employeeId);
      });
    }
    const refs = await this.refs(notFoundIds, runs.flatMap((r) => r.plan as unknown as PlanItem[]));
    const notFound = notFoundIds.filter((id) => !confidential.hidden.has(id)).flatMap((id) => (refs.has(id) ? [refs.get(id)!] : []));
    return {
      app: app?.view ?? null,
      connection: await this.zoho.connectionView(c),
      canManage: manages,
      canFetch: true,
      current: views.find((v) => v.status === 'running') ?? null,
      runs: views,
      notFound,
      hiddenNotFound: notFoundIds.filter((id) => confidential.hidden.has(id)).length,
      nightly: {
        time: ZOHO_PEOPLE_NIGHTLY_TIME,
        last: lastNightly?.nightlyFor
          ? { day: fromDateOnly(lastNightly.nightlyFor), status: lastNightly.status as ZohoRunStatus, finishedAt: lastNightly.finishedAt?.toISOString() ?? null, problem: lastNightly.problem }
          : null,
      },
      people,
      timeZone: this.zoho.timeZoneOf(c),
    };
  }

  /** GET /zoho-people/people: everyone with an employment, for choosing whom to fetch (former employees marked). */
  async people(user: SessionUser): Promise<{ id: string; name: string; employeeCode: string; former: boolean }[]> {
    this.zoho.assertFetcher(user);
    const today = toDateOnly(todayInCairo());
    const confidential = await this.confidential.view(user);
    const rows = await this.prisma.employee.findMany({
      where: { employments: { some: {} }, ...(confidential.hidden.size && { id: { notIn: [...confidential.hidden] } }) },
      orderBy: [{ fullNameEn: 'asc' }, { employeeCode: 'asc' }],
      select: { id: true, fullNameEn: true, employeeCode: true, employments: { where: { joinDate: { lte: today }, OR: [{ endDate: null }, { endDate: { gte: today } }] }, select: { id: true } } },
    });
    return rows.map((r) => ({ id: r.id, name: r.fullNameEn, employeeCode: r.employeeCode, former: !r.employments.length }));
  }

  /**
   * GET /zoho-people/note: what the dashboard tells HR and a Super Admin (the brief: "On failure (expired token, Zoho
   * down), a clear status on the page and a dashboard note for Super Admin and HR"): the connection needing connecting
   * again, or last night's fetch failed (until a fetch of everyone covers its day); nothing otherwise (nor before Zoho
   * People is connected).
   */
  async note(user: SessionUser): Promise<ZohoPeopleNote> {
    this.zoho.assertFetcher(user);
    const c = await this.zoho.connection();
    if (!c) return null;
    if (c.status === 'needs_reconnecting') {
      return { tone: 'danger', text: `Zoho People’s connection needs connecting again, so its check-ins aren’t fetched: ${c.problem ?? 'Zoho refused its sign-in.'} A Super Admin connects it on Organization → Zoho People.` };
    }
    const last = await this.prisma.zohoPeopleRun.findFirst({ where: { kind: 'nightly' }, orderBy: { nightlyFor: 'desc' } });
    // a fetch of everyone that finished since, its days covering that night's: fetched again, nothing to say
    const fetchedSince =
      last?.status === 'failed' && last.nightlyFor
        ? await this.prisma.zohoPeopleRun.count({ where: { status: 'finished', employeeIds: { isEmpty: true }, fromDate: { lte: last.nightlyFor }, toDate: { gte: last.nightlyFor }, startedAt: { gt: last.startedAt } } })
        : 0;
    if (last?.status === 'failed' && last.nightlyFor && !fetchedSince) {
      return { tone: 'danger', text: `The nightly fetch from Zoho People for ${fromDateOnly(last.nightlyFor)} failed: ${last.problem ?? 'it stopped.'} Fetch that day again on Organization → Zoho People.` };
    }
    return null;
  }
}

/**
 * Whether Zoho's day kept already is the day fetched (the brief: "matched by time and not added twice"): the same
 * check-in and check-out to the minute, and the same pairs and open check-in when it was kept with them (an Excel
 * import's day keeps only its first and last); a day without a check-in, the same kind of Zoho status.
 */
function sameZohoDay(
  was: { checkIn: Date | null; checkOut: Date | null; zohoStatus: string | null; pairs: Prisma.JsonValue; openAt: Date | null },
  d: AttendanceDayResult,
  f: ZohoDay,
): boolean {
  if (minuteOf(was.checkIn) !== minuteOf(d.checkIn) || minuteOf(was.checkOut) !== minuteOf(d.checkOut)) return false;
  if (!d.checkIn && !was.checkIn) return zohoStatusKind(was.zohoStatus) === zohoStatusKind(d.zohoStatus);
  if (was.pairs === null || was.pairs === undefined) return true;
  const kept = Array.isArray(was.pairs) ? (was.pairs as { in: string; out: string }[]) : [];
  const now = d.pairs ?? [];
  return (
    kept.length === now.length &&
    kept.every((p, i) => minuteOf(p.in) === minuteOf(now[i].in) && minuteOf(p.out) === minuteOf(now[i].out)) &&
    minuteOf(was.openAt) === minuteOf(f.openAt)
  );
}
