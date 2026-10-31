import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AllowancesModule } from './allowances/allowances.module.js';
import { AssetsModule } from './assets/assets.module.js';
import { AttendanceModule } from './attendance/attendance.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AuditLogModule } from './audit/audit-log.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ClientAccountsModule } from './client-accounts/client-accounts.module.js';
import { CompanyModule } from './company/company.module.js';
import { ConnectorModule } from './connector/connector.module.js';
import { ConfirmationsModule } from './confirmations/confirmations.module.js';
import { ContractsModule } from './contracts/contracts.module.js';
import { DocumentsModule } from './documents/documents.module.js';
import { ConfidentialModule } from './employees/confidential.module.js';
import { EmployeesModule } from './employees/employees.module.js';
import { HealthController } from './health/health.controller.js';
import { AppReleasesModule } from './app-version/app-releases.module.js';
import { KpisModule } from './kpis/kpis.module.js';
import { LeaveModule } from './leave/leave.module.js';
import { MailModule } from './mail/mail.module.js';
import { MeetingsModule } from './meetings/meetings.module.js';
import { CalendarsModule } from './calendars/calendars.module.js';
import { InterviewHoursModule } from './interview-hours/interview-hours.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { OffersModule } from './offers/offers.module.js';
import { OffboardingModule } from './offboarding/offboarding.module.js';
import { OnboardingModule } from './onboarding/onboarding.module.js';
import { ResignationRequestsModule } from './resignation-requests/resignation-requests.module.js';
import { RecruitmentModule } from './recruitment/recruitment.module.js';
import { VersionController } from './health/version.controller.js';
import { OrganisationModule } from './organisation/organisation.module.js';
import { PaperworkModule } from './paperwork/paperwork.module.js';
import { PayrollModule } from './payroll/payroll.module.js';
import { PayrollAdjustmentsModule } from './payroll/adjustments/adjustments.module.js';
import { LawRatesModule } from './payroll/law-rates/law-rates.module.js';
import { PayrollLockedChangesModule } from './payroll/locked-changes/locked-changes.module.js';
import { PayrollStatisticsModule } from './payroll/statistics/statistics.module.js';
import { SocialInsuranceReportModule } from './payroll/social-insurance/social-insurance.module.js';
import { UnsettledModule } from './payroll/unsettled/unsettled.module.js';
import { PdfModule } from './pdf/pdf.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { ReimbursementsModule } from './reimbursements/reimbursements.module.js';
import { TemplatesModule } from './templates/templates.module.js';
import { UsersModule } from './users/users.module.js';
import { EmployeeAccessModule } from './employee-access/employee-access.module.js';
import { WfhModule } from './wfh/wfh.module.js';
import { CompensatoryModule } from './compensatory/compensatory.module.js';
import { OdModule } from './official-duty/od.module.js';
import { WhatsAppModule } from './whatsapp/whatsapp.module.js';
import { ZohoPeopleModule } from './zoho-people/zoho-people.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuditModule,
    // the app's newest build, for its force update (owner, 31 October 2026)
    AppReleasesModule,
    ConfidentialModule,
    MailModule,
    // WhatsApp notifications (owner, 24 October 2026: "how to make whatsapp notifications?"; "Directly to Meta"): a
    // channel beside the bell, push and email, for those who opt in
    WhatsAppModule,
    NotificationsModule,
    PdfModule,
    AuthModule,
    CompanyModule,
    OrganisationModule,
    AllowancesModule,
    // Clients → Client Accounts and the accounts allowance (owner, 25 October 2026)
    ClientAccountsModule,
    EmployeesModule,
    ContractsModule,
    // an employee's request to resign (owner, 26 October 2026: "the employee has to request resignation and then the HR generates the document")
    ResignationRequestsModule,
    ConfirmationsModule,
    PaperworkModule,
    TemplatesModule,
    DocumentsModule,
    OffersModule,
    LawRatesModule,
    PayrollModule,
    PayrollAdjustmentsModule,
    PayrollLockedChangesModule,
    UnsettledModule,
    PayrollStatisticsModule,
    // the Social Insurance report (owner, 27 October 2026: "is there a report for the social insurance? to be filled from
    // the social insurance tab"): the register, a month's contributions and the missing data, from each profile's tab
    SocialInsuranceReportModule,
    ReimbursementsModule,
    LeaveModule,
    AttendanceModule,
    // working from home (owner, 21 October 2026: "think about how should we handle the working from home in out erp")
    WfhModule,
    CompensatoryModule,
    // official duty (owner, 23 October 2026: "Official duty (OD) requests"): manager, then HR; counted as attended
    OdModule,
    OffboardingModule,
    // recruitment, the ATS (owner, 22 October 2026: "where will we include the ATS?"): vacancies, the careers page, applicants
    RecruitmentModule,
    // online interview meetings (owner, 24 October 2026: "Google Meet, Microsoft Teams, Zoom"; "make it both")
    MeetingsModule,
    // interviewers' availability (25 October 2026): the calendars read for busy times, and the interview hours
    CalendarsModule,
    InterviewHoursModule,
    // Zoho People's check-ins and check-outs pulled in, nightly and on HR's "Fetch from Zoho" (owner, 25 October 2026:
    // "Yes, daily + backfill"), through the calendars' Zoho app and the attendance import's way
    ZohoPeopleModule,
    OnboardingModule,
    // KPIs (owner, 21 October 2026: "lets start with the KPI's First")
    KpisModule,
    // Assets (owner, 21 October 2026: "i want to add this module with a special permission to the system")
    AssetsModule,
    // the Claude connector's sign-in (owner, 21 October 2026: "the connection method"), Assets' step 2
    ConnectorModule,
    UsersModule,
    // every active employee gets access (22 October 2026): accounts, set-password links, the sweep
    EmployeeAccessModule,
    AuditLogModule,
  ],
  controllers: [HealthController, VersionController],
})
export class AppModule {}
