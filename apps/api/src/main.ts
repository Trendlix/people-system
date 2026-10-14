import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  // No CORS: browsers never call this API directly; the Next.js server does.
  await app.listen(process.env.PORT ?? 3001);
}
await bootstrap();
