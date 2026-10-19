import { Module } from '@nestjs/common';
import { AttendanceController } from './attendance.controller.js';
import { AttendanceImportsController } from './attendance-imports.controller.js';
import { AttendanceImportsService } from './attendance-imports.service.js';
import { AttendanceService } from './attendance.service.js';

// Attendance (owner, 19 October 2026: attendance runs in Zoho People today, "Import Zoho now, replace it later"): Zoho
// People's attendance entries imported on a draft payroll run, each day kept (AttendanceDay) for the system's own
// attendance to build on later; and the Attendance section's reads of them (owner, 19 October 2026: "the attendance is
// not active in the side menu"): Daily Attendance, a person's month, a manager's team, the employee's own, the Summary
// and every import across the runs.
@Module({
  controllers: [AttendanceController, AttendanceImportsController],
  providers: [AttendanceService, AttendanceImportsService],
})
export class AttendanceModule {}
