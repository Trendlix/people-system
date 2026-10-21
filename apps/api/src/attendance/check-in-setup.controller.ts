import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser, DeletesRecords, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { ConfidentialOf } from '../employees/confidential.guard.js';
import { CreateCheckInLocationDto, LinkPeopleDto, UpdateCheckInLocationDto, UpdateLocationRuleDto, UpdateOfficeNetworksDto } from './check-in-setup.dto.js';
import { CheckInSetupService } from './check-in-setup.service.js';

// Attendance → Check-in Setup (owner, 20 October 2026: "Own page, several locations"): the check-in locations and the
// office networks with the lock (check-ins locked to the office network, the same day). HR and Admin (a Super Admin as an
// Admin); a location is removed by a Super Admin, as every deletion is. The networks' calls carry the visitor's address
// as the website signed it, so the page can say whether the lock is ready. The switch refusing presses without a location
// (owner, 20 October 2026: "Company switch + exceptions"), HR's and Admin's too. The main office and its sub-locations
// (owner, 20 October 2026: "main office location is the hero and other locations are like sub locations. shown with their
// name and linked users"): Make main, and the people linked to a sub-location, linked and unlinked by HR and Admin (a
// C-level person only by those who see them; the service checks), and who can be linked.
@Controller('attendance/check-in-setup')
export class CheckInSetupController {
  constructor(private readonly setup: CheckInSetupService) {}

  /** The main office first, then the sub-locations, each with its linked people the caller may see. */
  @Roles('hr', 'admin')
  @Get('locations')
  @Header('Cache-Control', 'private, no-store')
  locations(@CurrentUser() user: SessionUser) {
    return this.setup.locations(user);
  }

  /** { name, latitude, longitude, radiusMetres? }: 150 metres unless sent; the first one added is the main office. */
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

  /** This location becomes the main office, the main until now a sub-location; every location after it. */
  @Roles('hr', 'admin')
  @Post('locations/:id/make-main')
  @HttpCode(200)
  makeMain(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.setup.makeMain(id, user);
  }

  /** The main office only once it is the last location. */
  @DeletesRecords()
  @Delete('locations/:id')
  @HttpCode(204)
  removeLocation(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.setup.removeLocation(id, user);
  }

  /** Everyone with a current employment the caller may see: whom a sub-location's "Link people" offers. */
  @Roles('hr', 'admin')
  @Get('people')
  @Header('Cache-Control', 'private, no-store')
  linkable(@CurrentUser() user: SessionUser) {
    return this.setup.linkable(user);
  }

  /** { employeeIds }: linked to this sub-location; the location after it. */
  @Roles('hr', 'admin')
  @Post('locations/:id/people')
  @HttpCode(200)
  linkPeople(@Param('id', ParseUUIDPipe) id: string, @Body() dto: LinkPeopleDto, @CurrentUser() user: SessionUser) {
    return this.setup.linkPeople(id, dto, user);
  }

  /** Unlinked from this location (not a deletion of a record: HR's and Admin's); the location after it. */
  @Roles('hr', 'admin')
  @Post('locations/:id/people/:employeeId/unlink')
  @HttpCode(200)
  unlinkPerson(@Param('id', ParseUUIDPipe) id: string, @Param('employeeId', ParseUUIDPipe) employeeId: string, @CurrentUser() user: SessionUser) {
    return this.setup.unlinkPerson(id, employeeId, user);
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

  /** { refuseWithoutLocation }: the switch "Refuse check-ins and check-outs without a location". */
  @Roles('hr', 'admin')
  @Get('location-rule')
  @Header('Cache-Control', 'private, no-store')
  locationRule() {
    return this.setup.locationRule();
  }

  @Roles('hr', 'admin')
  @Put('location-rule')
  updateLocationRule(@Body() dto: UpdateLocationRuleDto, @CurrentUser() user: SessionUser) {
    return this.setup.updateLocationRule(dto, user);
  }
}

/**
 * A person's check-in places on their profile (owner, 20 October 2026: the sub-locations they are linked to, "Check-in
 * places: Studio, Client X"): HR, Admin, the CEO and the person themself; a C-level person's 404 for those who may not
 * see them.
 */
@Controller('employees/:employeeId/check-in-places')
export class EmployeeCheckInPlacesController {
  constructor(private readonly setup: CheckInSetupService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @ConfidentialOf('employee', 'employeeId')
  places(@Param('employeeId', ParseUUIDPipe) employeeId: string, @CurrentUser() user: SessionUser) {
    return this.setup.placesOf(employeeId, user);
  }
}
