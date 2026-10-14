import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CompanyModule } from './company/company.module.js';
import { HealthController } from './health/health.controller.js';
import { OrganisationModule } from './organisation/organisation.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, AuditModule, AuthModule, CompanyModule, OrganisationModule],
  controllers: [HealthController],
})
export class AppModule {}
