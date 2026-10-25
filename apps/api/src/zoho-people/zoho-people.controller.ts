import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, SetMetadata } from '@nestjs/common';
import { ZOHO_PEOPLE_HR_ONLY } from '@trendlix/shared';
import { CurrentUser, FORBIDDEN_MESSAGE, NotForDevelopers, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { ZohoPeopleSyncService } from './zoho-people-sync.service.js';
import { ZohoFetchDto, ZohoPeopleFinishDto, ZohoPeopleStartDto, ZohoPeopleTestDto } from './zoho-people.dto.js';
import { ZohoPeopleService } from './zoho-people.service.js';

// Organization → Zoho People (owner, 25 October 2026: "can i fetch checkin and out transactions from zoho people through
// api?"; asked, "Yes, daily + backfill"): HR's and a Super Admin's, never a developer's, not even to read
// (@NotForDevelopers: the routes name the connected account and the people not found); a developer's writes are refused
// by the guard as every write is. The connection (signing in, the test, disconnecting) is a Super Admin's in their own
// session (the service checks); "Fetch from Zoho", its progress and cancelling are HR's and a Super Admin's.

@Controller('zoho-people')
@Roles('hr', 'super_admin')
@SetMetadata(FORBIDDEN_MESSAGE, ZOHO_PEOPLE_HR_ONLY)
@NotForDevelopers()
export class ZohoPeopleController {
  constructor(
    private readonly zoho: ZohoPeopleService,
    private readonly sync: ZohoPeopleSyncService,
  ) {}

  /** The page: the connection, the run going and the last ones, those not found. */
  @NotForDevelopers()
  @Get()
  @Header('Cache-Control', 'private, no-store')
  view(@CurrentUser() user: SessionUser) {
    return this.sync.view(user);
  }

  /** The dashboard's note: the connection needing connecting again, or last night's fetch failed; null otherwise. */
  @NotForDevelopers()
  @Get('note')
  @Header('Cache-Control', 'private, no-store')
  note(@CurrentUser() user: SessionUser) {
    return this.sync.note(user);
  }

  /** Everyone with an employment, for choosing whom to fetch (former employees marked). */
  @NotForDevelopers()
  @Get('people')
  @Header('Cache-Control', 'private, no-store')
  people(@CurrentUser() user: SessionUser) {
    return this.sync.people(user);
  }

  /** A run, for its progress. */
  @NotForDevelopers()
  @Get('runs/:id')
  @Header('Cache-Control', 'private, no-store')
  run(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.sync.runView(id, user);
  }

  /** "Fetch from Zoho": started in the background, answered at once with the run (409 while another is going). */
  @NotForDevelopers()
  @Post('runs')
  fetch(@Body() dto: ZohoFetchDto, @CurrentUser() user: SessionUser) {
    return this.sync.startFetch(dto, user);
  }

  @NotForDevelopers()
  @Post('runs/:id/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.sync.cancel(id, user);
  }

  /** Zoho's sign-in page for Zoho People. A Super Admin's. */
  @NotForDevelopers()
  @Post('oauth/start')
  @HttpCode(200)
  start(@Body() dto: ZohoPeopleStartDto, @CurrentUser() user: SessionUser) {
    return this.zoho.start(dto.origin, user);
  }

  /** Zoho's return, passed on by the website: how it went. A Super Admin's. */
  @NotForDevelopers()
  @Post('oauth/finish')
  @HttpCode(200)
  finish(@Body() dto: ZohoPeopleFinishDto, @CurrentUser() user: SessionUser) {
    return this.zoho.finish(dto, user);
  }

  /** Today's attendance read for the connected account (and a colleague), in counts. A Super Admin's. */
  @NotForDevelopers()
  @Post('test')
  @HttpCode(200)
  test(@Body() dto: ZohoPeopleTestDto, @CurrentUser() user: SessionUser) {
    return this.zoho.test(dto.email, user);
  }

  /** The connection removed, its sign-in revoked at Zoho. A Super Admin's. */
  @NotForDevelopers()
  @Post('disconnect')
  @HttpCode(200)
  async disconnect(@CurrentUser() user: SessionUser) {
    await this.zoho.disconnect(user);
    return this.sync.view(user);
  }
}
