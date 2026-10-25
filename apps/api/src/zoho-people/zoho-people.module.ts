import { Module } from '@nestjs/common';
import { ZohoPeopleHttp } from './zoho-people-http.js';
import { ZohoPeopleSchedulerService } from './zoho-people-scheduler.service.js';
import { ZohoPeopleSyncService } from './zoho-people-sync.service.js';
import { ZohoPeopleController } from './zoho-people.controller.js';
import { ZohoPeopleService } from './zoho-people.service.js';

/**
 * Zoho People's check-ins and check-outs pulled in (owner, 25 October 2026: "can i fetch checkin and out transactions
 * from zoho people through api?"; asked, "Yes, daily + backfill"; then "but can it fetch historical data?"): the
 * connection a Super Admin makes once (through the Zoho app the calendars keep: CalendarsModule, global), the nightly run
 * and HR's "Fetch from Zoho", their days kept the Zoho import's way (AttendanceModule's import, corrections and fill:
 * global). ZohoPeopleHttp is the one door to Zoho People (the tests replace its fetch and its clock).
 */
@Module({
  controllers: [ZohoPeopleController],
  providers: [ZohoPeopleHttp, ZohoPeopleService, ZohoPeopleSyncService, ZohoPeopleSchedulerService],
  exports: [ZohoPeopleSyncService],
})
export class ZohoPeopleModule {}
