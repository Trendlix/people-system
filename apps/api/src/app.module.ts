import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AllowancesModule } from './allowances/allowances.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CompanyModule } from './company/company.module.js';
import { ConfirmationsModule } from './confirmations/confirmations.module.js';
import { ContractsModule } from './contracts/contracts.module.js';
import { DocumentsModule } from './documents/documents.module.js';
import { EmployeesModule } from './employees/employees.module.js';
import { HealthController } from './health/health.controller.js';
import { MailModule } from './mail/mail.module.js';
import { OffersModule } from './offers/offers.module.js';
import { VersionController } from './health/version.controller.js';
import { OrganisationModule } from './organisation/organisation.module.js';
import { PaperworkModule } from './paperwork/paperwork.module.js';
import { PayrollModule } from './payroll/payroll.module.js';
import { LawRatesModule } from './payroll/law-rates/law-rates.module.js';
import { PdfModule } from './pdf/pdf.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { TemplatesModule } from './templates/templates.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuditModule,
    MailModule,
    PdfModule,
    AuthModule,
    CompanyModule,
    OrganisationModule,
    AllowancesModule,
    EmployeesModule,
    ContractsModule,
    ConfirmationsModule,
    PaperworkModule,
    TemplatesModule,
    DocumentsModule,
    OffersModule,
    LawRatesModule,
    PayrollModule,
    UsersModule,
  ],
  controllers: [HealthController, VersionController],
})
export class AppModule {}
