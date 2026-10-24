import { Global, Module } from '@nestjs/common';
import { AttendanceController } from './attendance.controller.js';
import { AttendanceDaysService } from './attendance-days.service.js';
import { AttendanceHistoryService } from './attendance-history.service.js';
import { AttendanceFillService } from './attendance-fill.service.js';
import { AttendanceImportsController } from './attendance-imports.controller.js';
import { AttendanceImportsService } from './attendance-imports.service.js';
import { AttendanceService } from './attendance.service.js';
import { CheckInLocationEndingsService } from './check-in-location-endings.service.js';
import { CheckInSetupController, EmployeeCheckInPlacesController } from './check-in-setup.controller.js';
import { CheckInSetupService } from './check-in-setup.service.js';
import { CheckInController } from './check-in.controller.js';
import { CheckInService } from './check-in.service.js';
import { CorrectionDaysService } from './correction-days.service.js';
import { AttendanceCorrectionsController, MyCorrectionsController } from './corrections.controller.js';
import { AttendanceCorrectionsService } from './corrections.service.js';
import { HomeLocationsController, MyHomeLocationsController } from './home-locations.controller.js';
import { HomeLocationsService } from './home-locations.service.js';
import { MapsKeyController, MapsSettingsController } from './maps-settings.controller.js';
import { MapsSettingsService } from './maps-settings.service.js';

// Attendance (owner, 19 October 2026: attendance runs in Zoho People today, "Import Zoho now, replace it later"): Zoho
// People's attendance entries imported on a draft payroll run, each day kept (AttendanceDay) for the system's own
// attendance to build on later; and the Attendance section's reads of them (owner, 19 October 2026: "the attendance is
// not active in the side menu"): Daily Attendance, a person's month, a manager's team, the employee's own, the Summary
// and every import across the runs. Checking in on the system (owner, 19 October 2026: "Check-in through the system
// (phone or web with the office location check, or a device) to replace Zoho"): Check in and Check out, each day kept
// from the punches, and a draft run's lines filled from the month's days (AttendanceFillService, which the payroll runs
// use too: global). Attendance corrections (owner, 19 October 2026: "Attendance corrections with approval ("I forgot to
// check out")"): asked by the employee, decided by their manager then HR, or made by HR directly; the corrected day kept
// over the day it corrects. Check-in Setup (owner, 20 October 2026: "Own page, several locations"): the check-in locations
// and the office networks with the lock on check-ins (CheckInSetupService). Home locations (owner, 20 October 2026: "allow
// other users to request to add their home locations when working from home"): asked by anyone, decided by HR then the
// CEO; a check-in within the person's approved home is Home (HomeLocationsService). The main office and its
// sub-locations (owner, 20 October 2026: "main office location is the hero and other locations are like sub locations"),
// each sub-location's people, and a person's check-in places on their profile (EmployeeCheckInPlacesController).
@Global()
@Module({
  controllers: [
    AttendanceController,
    AttendanceImportsController,
    CheckInController,
    CheckInSetupController,
    EmployeeCheckInPlacesController,
    MyCorrectionsController,
    AttendanceCorrectionsController,
    MyHomeLocationsController,
    HomeLocationsController,
    // Google Maps for every map (owner, 24 October 2026: "Google Maps"): the key a Super Admin pastes on Check-in Setup,
    // and the key at runtime for the pages that draw a map
    MapsSettingsController,
    MapsKeyController,
  ],
  providers: [
    AttendanceService,
    // a person's attendance history on their profile (owner, 23 October 2026)
    AttendanceHistoryService,
    AttendanceImportsService,
    AttendanceDaysService,
    AttendanceFillService,
    CheckInService,
    CheckInSetupService,
    CorrectionDaysService,
    AttendanceCorrectionsService,
    HomeLocationsService,
    // the ends of requested check-in locations told 7 days ahead (owner, 24 October 2026: "allow the HR to add an end date")
    CheckInLocationEndingsService,
    MapsSettingsService,
  ],
  exports: [AttendanceDaysService, AttendanceFillService],
})
export class AttendanceModule {}
