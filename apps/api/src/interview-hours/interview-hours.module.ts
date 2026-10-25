import { Global, Module } from '@nestjs/common';
import { AvailabilityService } from './availability.service.js';
import { AvailabilityController, InterviewHoursController, MyInterviewHoursController } from './interview-hours.controller.js';
import { InterviewHoursService } from './interview-hours.service.js';

/**
 * Interviewers' availability (owner, 25 October 2026: "is it better for each interviewer to add his available interviews
 * timeslots?"; "Hours + calendar"; "HR only"): weekly interview hours, the company's defaults, "Find a time" and the
 * warnings of a time typed by hand. Global, so interviews (recruitment) warn with it without wiring it into theirs; the
 * calendars' busy times come from CalendarsModule (global too).
 */
@Global()
@Module({
  controllers: [MyInterviewHoursController, InterviewHoursController, AvailabilityController],
  providers: [InterviewHoursService, AvailabilityService],
  exports: [InterviewHoursService, AvailabilityService],
})
export class InterviewHoursModule {}
