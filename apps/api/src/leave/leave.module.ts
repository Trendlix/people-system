import { Global, Module } from '@nestjs/common';
import {
  EmployeeLeaveController,
  LeaveCalendarController,
  LeaveRequestsController,
  LeaveSettingsController,
  LeaveStaffingController,
  LeaveTypesController,
  MyLeaveController,
  YearClosingController,
} from './leave.controller.js';
import { LeaveImportController } from './leave-import.controller.js';
import { LeaveImportService } from './leave-import.service.js';
import { LeaveBalancesService } from './leave-balances.service.js';
import { LeaveCoverageService } from './leave-coverage.service.js';
import { LeavePayrollService } from './leave-payroll.service.js';
import { LeaveReportController } from './leave-report.controller.js';
import { LeaveReportService } from './leave-report.service.js';
import { LeaveRequestsService } from './leave-requests.service.js';
import { LeaveSettlementService } from './leave-settlement.service.js';
import { LeaveTypesService } from './leave-types.service.js';
import { EmployeePermissionsController, MyPermissionsController, PermissionRequestsController } from './permissions.controller.js';
import { PermissionRequestsService } from './permissions.service.js';
import { StandInSchedulerService } from './stand-in-scheduler.service.js';
import { YearClosingService } from './year-closing.service.js';

// Leave (owner, 18 October 2026: "if we will work on the attendance and leaves, how will we build it?", leave first; "can
// you apply the leaves according to the law?"): Leave Setup (the law's types and the annual leave's numbers), requests
// decided by the direct manager then HR, the balances by calendar year, the Year Closing ("make it with decision with the
// year closing"), the unused leave paid on leaving and the month's leave on the draft payroll lines. Global, as the final
// settlements (Unsettled) list the unused leave and record it paid (LeaveSettlementService). Permission requests (owner,
// 19 October 2026: "4 hours per month with a maximum 2 hours per day", asked "In the system, like leave"), decided as
// leave is, their hours counted as worked on the draft payroll lines. Importing leave in bulk (owner, 21 October 2026:
// "how to import bulk leaves?"): the leave taken and the balances from the template or Zoho People's leave export. Leave
// coverage (owner, 25 October 2026): who else is off, the teams' staffing limits, the colleague who covers, and the
// stand-in of an approver on leave, told when it starts (StandInSchedulerService, started by main.ts).
@Global()
@Module({
  controllers: [
    LeaveTypesController,
    LeaveSettingsController,
    MyLeaveController,
    LeaveRequestsController,
    LeaveCalendarController,
    LeaveStaffingController,
    YearClosingController,
    EmployeeLeaveController,
    MyPermissionsController,
    PermissionRequestsController,
    EmployeePermissionsController,
    LeaveImportController,
    LeaveReportController,
  ],
  providers: [
    LeaveTypesService,
    LeaveBalancesService,
    LeaveRequestsService,
    LeavePayrollService,
    YearClosingService,
    LeaveSettlementService,
    PermissionRequestsService,
    LeaveImportService,
    LeaveCoverageService,
    StandInSchedulerService,
    LeaveReportService,
  ],
  exports: [LeaveBalancesService, LeaveSettlementService, StandInSchedulerService],
})
export class LeaveModule {}
