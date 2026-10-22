import { Module } from '@nestjs/common';
import { KpiAttendanceService } from './kpi-attendance.service.js';
import { KpiFrameworkService } from './kpi-framework.service.js';
import { KpiNoticesService } from './kpi-notices.service.js';
import { KpiOpeningService } from './kpi-opening.service.js';
import { KpiOverviewService } from './kpi-overview.service.js';
import { KpiPracticeService } from './kpi-practice.service.js';
import { KpiSchedulerService } from './kpi-scheduler.service.js';
import { KpiScorecardsService } from './kpi-scorecards.service.js';
import { KpiSettingsService } from './kpi-settings.service.js';
import { KpiTemplatesService } from './kpi-templates.service.js';
import { KpiFrameworkController, KpiPracticeController, KpiScorecardsController, KpiSettingsController, KpiTemplatesController } from './kpis.controller.js';

/**
 * KPIs (owner, 21 October 2026: "lets start with the KPI's First"; packages/shared kpis.ts): the KPI settings (the
 * deadlines), the templates per job title (a draft and published versions), the monthly scorecards and their steps
 * (self-rating, the manager's scoring, HR's calibration, the sign-off), their clock (opening on the 1st, the deadlines,
 * the reminders: KpiSchedulerService, started by main.ts), the overview, the heatmap and the Excel export. The payroll
 * reads the final scorecards itself (payroll/kpi-terms.ts). The KPI framework (owner, 21 October 2026: "Fully
 * flexible"): the pillars and their weights, versioned, which the templates place their metrics in. Practice
 * scorecards (owner, 22 October 2026: "Practice scorecards"): tried by HR or a Super Admin, counted nowhere.
 */
@Module({
  controllers: [KpiSettingsController, KpiFrameworkController, KpiTemplatesController, KpiScorecardsController, KpiPracticeController],
  providers: [
    KpiSettingsService,
    KpiFrameworkService,
    KpiTemplatesService,
    KpiAttendanceService,
    KpiOpeningService,
    KpiNoticesService,
    KpiScorecardsService,
    KpiOverviewService,
    KpiSchedulerService,
    KpiPracticeService,
  ],
  exports: [KpiSchedulerService],
})
export class KpisModule {}
