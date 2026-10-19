import { Global, Module } from '@nestjs/common';
import {
  EmployeeLeaveController,
  LeaveCalendarController,
  LeaveRequestsController,
  LeaveSettingsController,
  LeaveTypesController,
  MyLeaveController,
  YearClosingController,
} from './leave.controller.js';
import { LeaveBalancesService } from './leave-balances.service.js';
import { LeavePayrollService } from './leave-payroll.service.js';
import { LeaveRequestsService } from './leave-requests.service.js';
import { LeaveSettlementService } from './leave-settlement.service.js';
import { LeaveTypesService } from './leave-types.service.js';
import { EmployeePermissionsController, MyPermissionsController, PermissionRequestsController } from './permissions.controller.js';
import { PermissionRequestsService } from './permissions.service.js';
import { YearClosingService } from './year-closing.service.js';

// Leave (owner, 18 October 2026: "if we will work on the attendance and leaves, how will we build it?", leave first; "can
// you apply the leaves according to the law?"): Leave Setup (the law's types and the annual leave's numbers), requests
// decided by the direct manager then HR, the balances by calendar year, the Year Closing ("make it with decision with the
// year closing"), the unused leave paid on leaving and the month's leave on the draft payroll lines. Global, as the final
// settlements (Unsettled) list the unused leave and record it paid (LeaveSettlementService). Permission requests (owner,
// 19 October 2026: "4 hours per month with a maximum 2 hours per day", asked "In the system, like leave"), decided as
// leave is, their hours counted as worked on the draft payroll lines.
@Global()
@Module({
  controllers: [
    LeaveTypesController,
    LeaveSettingsController,
    MyLeaveController,
    LeaveRequestsController,
    LeaveCalendarController,
    YearClosingController,
    EmployeeLeaveController,
    MyPermissionsController,
    PermissionRequestsController,
    EmployeePermissionsController,
  ],
  providers: [LeaveTypesService, LeaveBalancesService, LeaveRequestsService, LeavePayrollService, YearClosingService, LeaveSettlementService, PermissionRequestsService],
  exports: [LeaveBalancesService, LeaveSettlementService],
})
export class LeaveModule {}
