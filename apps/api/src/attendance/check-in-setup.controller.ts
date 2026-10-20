import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser, DeletesRecords, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { CreateCheckInLocationDto, UpdateCheckInLocationDto, UpdateOfficeNetworksDto } from './check-in-setup.dto.js';
import { CheckInSetupService } from './check-in-setup.service.js';

// Attendance → Check-in Setup (owner, 20 October 2026: "Own page, several locations"): the check-in locations and the
// office networks with the lock (check-ins locked to the office network, the same day). HR and Admin (a Super Admin as an
// Admin); a location is removed by a Super Admin, as every deletion is. The networks' calls carry the visitor's address
// as the website signed it, so the page can say whether the lock is ready.
@Controller('attendance/check-in-setup')
export class CheckInSetupController {
  constructor(private readonly setup: CheckInSetupService) {}

  @Roles('hr', 'admin')
  @Get('locations')
  locations() {
    return this.setup.locations();
  }

  /** { name, latitude, longitude, radiusMetres? }: 150 metres unless sent. */
  @Roles('hr', 'admin')
  @Post('locations')
  createLocation(@Body() dto: CreateCheckInLocationDto, @CurrentUser() user: SessionUser) {
    return this.setup.createLocation(dto, user);
  }

  @Roles('hr', 'admin')
  @Patch('locations/:id')
  updateLocation(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCheckInLocationDto, @CurrentUser() user: SessionUser) {
    return this.setup.updateLocation(id, dto, user);
  }

  @DeletesRecords()
  @Delete('locations/:id')
  @HttpCode(204)
  removeLocation(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.setup.removeLocation(id, user);
  }

  /** The networks, the switch, whether the lock is in force, and this request's signed address (never kept). */
  @Roles('hr', 'admin')
  @Get('networks')
  @Header('Cache-Control', 'private, no-store')
  networks(@Req() req: Request) {
    return this.setup.networks(req);
  }

  /** { lock, networks: [{ label, range }] }: the whole list. */
  @Roles('hr', 'admin')
  @Put('networks')
  updateNetworks(@Body() dto: UpdateOfficeNetworksDto, @Req() req: Request, @CurrentUser() user: SessionUser) {
    return this.setup.updateNetworks(dto, req, user);
  }
}
