import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { CustodySchedulerService } from './assets/custody-scheduler.service.js';
import { KpiSchedulerService } from './kpis/kpi-scheduler.service.js';
import { OffboardingSchedulerService } from './offboarding/offboarding-scheduler.service.js';
import { CvReadingsService } from './recruitment/cv-readings.service.js';
import { RecruitmentSchedulerService } from './recruitment/recruitment-scheduler.service.js';
import { RemindersService } from './notifications/reminders.service.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
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
  // offboarding's round (22 October 2026): leavers' sign-in disabled once their last working day has passed, and HR told
  // of the cases whose every item is cleared; the tests' apps don't start it either
  app.get(OffboardingSchedulerService).start();
  // the CVs read in the background, the ones already here first (22 October 2026: "make the OCR egine reads the CV and analyse it")
  app.get(CvReadingsService).start();
  // recruitment's round (22 October 2026, Phase 2): each interviewer reminded of a scorecard not given the day after the
  // interview; the tests' apps don't start it either
  app.get(RecruitmentSchedulerService).start();
}
await bootstrap();
