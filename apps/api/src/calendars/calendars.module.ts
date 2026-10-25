import { Global, Module } from '@nestjs/common';
import { CalendarHttp } from './calendar-http.js';
import { CalendarsController, CalendarSettingsController } from './calendars.controller.js';
import { CalendarsService } from './calendars.service.js';

/**
 * Calendars read for interviewers' busy times (owner, 25 October 2026: "Hours + calendar"; "its zoho mails"): the
 * company's Zoho Calendar connection (Organization → Calendars) and each person's own Zoho, Google or Microsoft calendar,
 * with HR's own meetings connections that share busy times. Global, so the availability (interview-hours) reads busy
 * times without wiring this module into theirs; CalendarHttp is the one door to the calendars (the tests replace its
 * fetch). The meetings' apps and tokens come from MeetingsModule (global too).
 */
@Global()
@Module({ controllers: [CalendarSettingsController, CalendarsController], providers: [CalendarHttp, CalendarsService], exports: [CalendarsService, CalendarHttp] })
export class CalendarsModule {}
