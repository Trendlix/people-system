import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { AddCheckInExemptionsDto } from './check-in-exemptions.dto.js';
import { CheckInExemptionsService } from './check-in-exemptions.service.js';

// People exempt from check-in (owner, 25 October 2026: "allow me to select people that are not eligable for attendance
// checkins and outs, trat them as if they achived their full working hours"; asked, "Profile + a list in Check-in
// Setup"): Check-in Setup's list, "Add people" (one or several) and "End now", for HR, an Admin and a Super Admin; the
// CEO for the C-level people (the service decides who manages whom); and a person's own on their profile.
@Controller('attendance/check-in-exemptions')
export class CheckInExemptionsController {
  constructor(private readonly exemptions: CheckInExemptionsService) {}

  /** The current and upcoming exemptions of the people the caller may see, and whether they add any. */
  @Roles('hr', 'admin', 'ceo')
  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@CurrentUser() user: SessionUser) {
    return this.exemptions.list(user);
  }

  /** { employeeIds, reason, startDate?, endDate? }: one reason and one period for each; all kept, or none. */
  @Roles('hr', 'admin', 'ceo')
  @Post()
  add(@Body() dto: AddCheckInExemptionsDto, @CurrentUser() user: SessionUser) {
    return this.exemptions.add(dto, user);
  }

  /** "End now": ended today; one not started yet cancelled. */
  @Roles('hr', 'admin', 'ceo')
  @Post(':id/end')
  @HttpCode(200)
  end(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.exemptions.end(id, user);
  }
}

/** A person's exemptions on their profile: HR, an Admin, the CEO, a Super Admin and the person themself (the service checks). */
@Controller('employees/:employeeId/check-in-exemptions')
export class EmployeeCheckInExemptionsController {
  constructor(private readonly exemptions: CheckInExemptionsService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  ofEmployee(@Param('employeeId', ParseUUIDPipe) employeeId: string, @CurrentUser() user: SessionUser) {
    return this.exemptions.ofEmployee(employeeId, user);
  }
}
