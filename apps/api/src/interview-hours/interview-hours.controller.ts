import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Put, SetMetadata } from '@nestjs/common';
import { CurrentUser, FORBIDDEN_MESSAGE, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { AvailabilityService } from './availability.service.js';
import { AvailabilityDto, InterviewDefaultsDto, InterviewHoursDto, TimeCheckDto } from './interview-hours.dto.js';
import { InterviewHoursService } from './interview-hours.service.js';

// Interviewers' availability (owner, 25 October 2026: "is it better for each interviewer to add his available interviews
// timeslots?"; asked, "Hours + calendar" and "HR only"):
// - one's own interview hours, their interviews to come and the dashboard's reminder: anyone signed in with an employee
//   profile (the service says so in words to anyone else);
// - the company's defaults, the list of who interviews and anyone's hours: HR, the CEO and a Super Admin (a C-level
//   person's only the CEO and a Super Admin: the service answers 404 to HR);
// - "Find a time" and the check of a time typed by hand: HR and a Super Admin, who book interviews. Both are reads, sent
//   as POST for their lists: a developer is refused them as every POST.

const SETS = 'Only HR, the CEO and a Super Admin see and set the interview hours of others.';

/** One's own interview hours. */
@Controller('me/interview-hours')
export class MyInterviewHoursController {
  constructor(private readonly hours: InterviewHoursService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  mine(@CurrentUser() user: SessionUser) {
    return this.hours.mine(user);
  }

  /** The dashboard's "Set your interview hours so HR can book you". */
  @Get('reminder')
  @Header('Cache-Control', 'private, no-store')
  reminder(@CurrentUser() user: SessionUser) {
    return this.hours.reminder(user);
  }

  @Put()
  saveMine(@Body() dto: InterviewHoursDto, @CurrentUser() user: SessionUser) {
    return this.hours.saveMine(dto, user);
  }
}

/** Organization → Interview Hours: the company's defaults, who interviews, anyone's hours. */
@Controller('interview-hours')
@Roles('hr', 'ceo', 'super_admin')
@SetMetadata(FORBIDDEN_MESSAGE, SETS)
export class InterviewHoursController {
  constructor(private readonly hours: InterviewHoursService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  interviewers(@CurrentUser() user: SessionUser) {
    return this.hours.interviewers(user);
  }

  @Get('settings')
  settings() {
    return this.hours.settings();
  }

  @Put('settings')
  saveSettings(@Body() dto: InterviewDefaultsDto, @CurrentUser() user: SessionUser) {
    return this.hours.saveSettings(dto, user);
  }

  @Get('people/:employeeId')
  @Header('Cache-Control', 'private, no-store')
  ofPerson(@Param('employeeId', ParseUUIDPipe) employeeId: string, @CurrentUser() user: SessionUser) {
    return this.hours.ofPerson(employeeId, user);
  }

  @Put('people/:employeeId')
  saveForPerson(@Param('employeeId', ParseUUIDPipe) employeeId: string, @Body() dto: InterviewHoursDto, @CurrentUser() user: SessionUser) {
    return this.hours.saveForPerson(employeeId, dto, user);
  }
}

/** "Find a time" and the check of a time typed by hand, on the schedule and move forms. */
@Controller('recruitment/availability')
@Roles('hr', 'super_admin')
@SetMetadata(FORBIDDEN_MESSAGE, 'Only HR (or a Super Admin) finds times and books interviews.')
export class AvailabilityController {
  constructor(private readonly availability: AvailabilityService) {}

  @Post()
  @HttpCode(200)
  find(@Body() dto: AvailabilityDto, @CurrentUser() user: SessionUser) {
    return this.availability.find(dto, user);
  }

  @Post('check')
  @HttpCode(200)
  check(@Body() dto: TimeCheckDto, @CurrentUser() user: SessionUser) {
    return this.availability.check(dto, user);
  }
}
