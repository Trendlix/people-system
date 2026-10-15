import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CompanyModule } from './company/company.module.js';
import { ConfirmationsModule } from './confirmations/confirmations.module.js';
import { ContractsModule } from './contracts/contracts.module.js';
import { EmployeesModule } from './employees/employees.module.js';
import { HealthController } from './health/health.controller.js';
import { VersionController } from './health/version.controller.js';
import { OrganisationModule } from './organisation/organisation.module.js';
import { PaperworkModule } from './paperwork/paperwork.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, AuditModule, AuthModule, CompanyModule, OrganisationModule, EmployeesModule, ContractsModule, ConfirmationsModule, PaperworkModule, UsersModule],
  controllers: [HealthController, VersionController],
})
export class AppModule {}
