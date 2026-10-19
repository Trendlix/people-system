import { Module } from '@nestjs/common';
import { AttendanceImportsController } from './attendance-imports.controller.js';
import { AttendanceImportsService } from './attendance-imports.service.js';

// Attendance (owner, 19 October 2026: attendance runs in Zoho People today, "Import Zoho now, replace it later"): Zoho
// People's attendance entries imported on a draft payroll run, each day kept (AttendanceDay) for the system's own
// attendance to build on later.
@Module({
  controllers: [AttendanceImportsController],
  providers: [AttendanceImportsService],
})
export class AttendanceModule {}
