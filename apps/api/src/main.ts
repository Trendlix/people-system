import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { RemindersService } from './notifications/reminders.service.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  // No CORS: browsers never call this API directly; the Next.js server does.
  await app.listen(process.env.PORT ?? 3001);
  // the check-in reminders, every 5 minutes (apps/mobile/README.md, Phase 4); the tests' apps don't start them
  app.get(RemindersService).start();
}
await bootstrap();
