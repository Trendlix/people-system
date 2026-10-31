import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { AuthService } from './auth/auth.service.js';
import { docsAccess } from './docs/docs-access.js';
import { setupDocs } from './docs/docs.js';
import { CustodySchedulerService } from './assets/custody-scheduler.service.js';
import { CheckInLocationEndingsService } from './attendance/check-in-location-endings.service.js';
import { HoursByPairsService } from './attendance/hours-by-pairs.service.js';
import { KpiSchedulerService } from './kpis/kpi-scheduler.service.js';
import { StandInSchedulerService } from './leave/stand-in-scheduler.service.js';
import { EmployeeAccessSchedulerService } from './employee-access/employee-access-scheduler.service.js';
import { OffboardingSchedulerService } from './offboarding/offboarding-scheduler.service.js';
import { CandidatesService } from './recruitment/candidates.service.js';
import { CvReadingsService } from './recruitment/cv-readings.service.js';
import { RecruitmentSchedulerService } from './recruitment/recruitment-scheduler.service.js';
import { RemindersService } from './notifications/reminders.service.js';
import { WfhFullDaysService } from './wfh/wfh-full-days.service.js';
import { WhatsAppSenderService } from './whatsapp/whatsapp-sender.service.js';
import { ZohoPeopleSchedulerService } from './zoho-people/zoho-people-scheduler.service.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  // the API documentation (owner, 31 October 2026: "Use Swagger to make apis documentation"): /api/docs/app, /web and
  // /admin, behind a People sign-in of a Super Admin or a developer
  app.use('/api/docs', docsAccess(app.get(AuthService)));
  setupDocs(app, process.env.PEOPLE_COMMIT?.slice(0, 7) || 'development');
  // No CORS: browsers never call this API directly; the Next.js server does.
  await app.listen(process.env.PORT ?? 3001);
  // the check-in reminders, looked for every minute (apps/mobile/README.md, Phase 4); the tests' apps don't start them
  app.get(RemindersService).start();
  // the KPI scorecards' clock (owner, 21 October 2026: "Last month's KPI, this pay"): last month's opened on the 1st,
  // the deadlines gone by applied, the reminders the day before each; the tests' apps don't start it either
  app.get(KpiSchedulerService).start();
  // custody's daily check (Assets step 3, 21 October 2026): overdue shoots told once a day, records not signed after
  // 3 days told once; the tests' apps don't start it either
  app.get(CustodySchedulerService).start();
  // requested check-in locations' ends (24 October 2026): the employee and HR told 7 days before an end that is a date;
  // the tests' apps don't start it either
  app.get(CheckInLocationEndingsService).start();
  // stand-ins told when an approver's leave starts (owner, 25 October 2026: "To a stand-in"); the tests' apps don't start
  // it either: they call its rounds themselves
  app.get(StandInSchedulerService).start();
  // offboarding's round (22 October 2026): leavers' sign-in disabled once their last working day has passed, and HR told
  // of the cases whose every item is cleared; the tests' apps don't start it either
  app.get(OffboardingSchedulerService).start();
  // the accounts of active employees with active contracts (22 October 2026), made every few minutes; nothing is sent
  app.get(EmployeeAccessSchedulerService).start();
  // recruitment's round (22 October 2026, Phase 2): each interviewer reminded of a scorecard not given the day after the
  // interview; the tests' apps don't start it either
  app.get(RecruitmentSchedulerService).start();
  // a day as the sum of its check-in → check-out pairs (owner, 25 October 2026: "the working hours to be calculated between
  // the checkin and out only, not the first and last"; "Months not yet paid"): the days kept before recounted once, under
  // an advisory lock, the drafts refilled; idempotent, so later starts find nothing to change; the tests run it themselves
  app.get(HoursByPairsService).start();
  // approved work from home days without a check-in counted full (owner, 26 October 2026: "Full day, always"): the draft
  // payroll lines of the people with one in their month refilled once, under an advisory lock; idempotent; the tests run it themselves
  app.get(WfhFullDaysService).start();
  // the CVs read in the background, the ones already here first (22 October 2026: "make the OCR egine reads the CV and analyse it")
  app.get(CvReadingsService).start();
  // candidate profiles (22 October 2026: "how to make like a profile for each candidate …"): the applications and general
  // CVs from before joined to theirs once, under an advisory lock, then a sweep every 10 minutes; the tests run it themselves
  app.get(CandidatesService).start();
  // WhatsApp's sender (owner, 24 October 2026: "Directly to Meta"): a round every 15 seconds, the candidates' reminders
  // the day before their interview with it; the tests' apps don't start it either: they run its rounds themselves
  app.get(WhatsAppSenderService).start();
  // Zoho People's clock (owner, 25 October 2026: "Yes, daily + backfill"): every minute a fetch left without a process
  // (the API restarted) taken on again, and from 02:00 Cairo the night's fetch of yesterday, once; the tests' apps don't
  // start it either: they call its rounds themselves
  app.get(ZohoPeopleSchedulerService).start();
}
await bootstrap();
