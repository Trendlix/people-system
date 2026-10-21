import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { KpiSchedulerService } from './kpis/kpi-scheduler.service.js';
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
}
await bootstrap();
