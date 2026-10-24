import { Body, Controller, Delete, Get, Header, Put, SetMetadata } from '@nestjs/common';
import { MAPS_SETTINGS_SUPER_ADMIN_ONLY } from '@trendlix/shared';
import { CurrentUser, FORBIDDEN_MESSAGE, NotForDevelopers, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { MapsSettingsDto } from './maps-settings.dto.js';
import { MapsSettingsService } from './maps-settings.service.js';

// Organization → Check-in Setup → Google Maps (owner, 24 October 2026: "Google Maps"): a Super Admin's only, in their own
// session (the service refuses one viewing as someone). Never a developer's, not even to read (@NotForDevelopers): the
// settings hold the company's key. Writes are refused to a developer by the guard as every write is.
@Controller('maps-settings')
@Roles('super_admin')
@SetMetadata(FORBIDDEN_MESSAGE, MAPS_SETTINGS_SUPER_ADMIN_ONLY)
@NotForDevelopers()
export class MapsSettingsController {
  constructor(private readonly settings: MapsSettingsService) {}

  /** Whether a key is saved and its last four characters ("…Ab3x"), never the key; the Map ID. */
  @NotForDevelopers()
  @Get()
  @Header('Cache-Control', 'private, no-store')
  get(@CurrentUser() user: SessionUser) {
    return this.settings.get(user);
  }

  /** Saves them; an empty key keeps the saved one. */
  @NotForDevelopers()
  @Put()
  update(@Body() dto: MapsSettingsDto, @CurrentUser() user: SessionUser) {
    return this.settings.update(dto, user);
  }

  /** "Remove the key": a Super Admin's, as every DELETE is (the controller's @Roles); every map back on OpenStreetMap. */
  @NotForDevelopers()
  @Delete('key')
  removeKey(@CurrentUser() user: SessionUser) {
    return this.settings.removeKey(user);
  }
}

// The key at runtime, for the pages that draw a map (the website's /maps-key passes it on to the browser): signed-in
// staff whose pages show a map, never a developer (@NotForDevelopers: their maps stay on OpenStreetMap). Not kept by the
// browser or any cache on the way, so a key replaced or removed takes effect on the next page.
@Controller('maps')
@NotForDevelopers()
export class MapsKeyController {
  constructor(private readonly settings: MapsSettingsService) {}

  /** { provider: 'google', key, mapId } with a key saved, else { provider: 'openstreetmap' }. */
  @NotForDevelopers()
  @Get('key')
  @Header('Cache-Control', 'private, no-store')
  key(@CurrentUser() user: SessionUser) {
    return this.settings.keyFor(user);
  }
}
