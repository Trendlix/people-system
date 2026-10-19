import { Global, Module } from '@nestjs/common';
import { AttendanceController } from './attendance.controller.js';
import { AttendanceDaysService } from './attendance-days.service.js';
import { AttendanceFillService } from './attendance-fill.service.js';
import { AttendanceImportsController } from './attendance-imports.controller.js';
import { AttendanceImportsService } from './attendance-imports.service.js';
import { AttendanceService } from './attendance.service.js';
import { CheckInController } from './check-in.controller.js';
import { CheckInService } from './check-in.service.js';
import { CorrectionDaysService } from './correction-days.service.js';
import { AttendanceCorrectionsController, MyCorrectionsController } from './corrections.controller.js';
import { AttendanceCorrectionsService } from './corrections.service.js';

// Attendance (owner, 19 October 2026: attendance runs in Zoho People today, "Import Zoho now, replace it later"): Zoho
// People's attendance entries imported on a draft payroll run, each day kept (AttendanceDay) for the system's own
// attendance to build on later; and the Attendance section's reads of them (owner, 19 October 2026: "the attendance is
// not active in the side menu"): Daily Attendance, a person's month, a manager's team, the employee's own, the Summary
// and every import across the runs. Checking in on the system (owner, 19 October 2026: "Check-in through the system
// (phone or web with the office location check, or a device) to replace Zoho"): Check in and Check out, each day kept
// from the punches, and a draft run's lines filled from the month's days (AttendanceFillService, which the payroll runs
// use too: global). Attendance corrections (owner, 19 October 2026: "Attendance corrections with approval ("I forgot to
// check out")"): asked by the employee, decided by their manager then HR, or made by HR directly; the corrected day kept
// over the day it corrects.
@Global()
@Module({
  controllers: [AttendanceController, AttendanceImportsController, CheckInController, MyCorrectionsController, AttendanceCorrectionsController],
  providers: [AttendanceService, AttendanceImportsService, AttendanceDaysService, AttendanceFillService, CheckInService, CorrectionDaysService, AttendanceCorrectionsService],
  exports: [AttendanceDaysService, AttendanceFillService],
})
export class AttendanceModule {}
