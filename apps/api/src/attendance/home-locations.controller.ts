import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { ConfidentialOf } from '../employees/confidential.guard.js';
import { CreateHomeLocationDto, DecideHomeLocationDto, ListHomeLocationsDto, RemoveHomeLocationDto } from './home-locations.dto.js';
import { HomeLocationsService } from './home-locations.service.js';

// Home locations (owner, 20 October 2026: "allow other users to request to add their home locations when working from
// home"; "Label Home, flag elsewhere", decided by HR then the CEO). The employee's own: their requests, a new one,
// withdrawing one while it is being decided and removing their approved home. HR, the CEO and the Super Admin: the
// requests (HR not a C-level person's), how many wait for them, each one, the decision of its step, and removing an
// approved home. Managers and Finance are refused; who decides each step the service checks, and it tells anyone else a
// request isn't there.

/** The employee's own: anyone signed in with an employee profile. */
@Controller('me/home-locations')
export class MyHomeLocationsController {
  constructor(private readonly homes: HomeLocationsService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  mine(@CurrentUser() user: SessionUser) {
    return this.homes.mine(user);
  }

  /** { latitude, longitude, accuracy?, label? }: with HR first; 409 while another is being decided. */
  @Post()
  create(@Body() dto: CreateHomeLocationDto, @CurrentUser() user: SessionUser) {
    return this.homes.create(dto, user);
  }

  @Post(':id/withdraw')
  @HttpCode(200)
  withdraw(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.homes.withdraw(id, user);
  }

  /** Their approved home removed: its point deleted. */
  @Post(':id/remove')
  @HttpCode(200)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.homes.remove(id, {}, user);
  }
}

@Controller('home-locations')
export class HomeLocationsController {
  constructor(private readonly homes: HomeLocationsService) {}

  /** ?status=<a status, waiting or open>&employeeId=: HR (not a C-level person's), the CEO and the Super Admin; 403 for anyone else. */
  @Get()
  @Header('Cache-Control', 'private, no-store')
  @ConfidentialOf('employee', { query: 'employeeId' })
  list(@Query() query: ListHomeLocationsDto, @CurrentUser() user: SessionUser) {
    return this.homes.list(query, user);
  }

  /** { waiting }: how many wait for the caller's decision. */
  @Get('counts')
  @Header('Cache-Control', 'private, no-store')
  counts(@CurrentUser() user: SessionUser) {
    return this.homes.counts(user);
  }

  /** For its employee, HR, the CEO and the Super Admin; 404 for anyone else. */
  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  one(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.homes.one(id, user);
  }

  /** { decision: approve | reject, comment? (required to reject), radiusMetres? (HR's step) }. */
  @Post(':id/decide')
  @HttpCode(200)
  decide(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideHomeLocationDto, @CurrentUser() user: SessionUser) {
    return this.homes.decide(id, dto, user);
  }

  /** { comment? }: an approved home removed by HR, the CEO or the Super Admin (or its employee): its point deleted. */
  @Post(':id/remove')
  @HttpCode(200)
  remove(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RemoveHomeLocationDto, @CurrentUser() user: SessionUser) {
    return this.homes.remove(id, dto, user);
  }
}
