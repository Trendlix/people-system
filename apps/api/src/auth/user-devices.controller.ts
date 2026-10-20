import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser, Roles } from './decorators.js';
import { DeviceCredentialsService, type DeviceView } from './device-credentials.service.js';
import type { SessionUser } from './session-user.js';

// A user's phones that sign in with a fingerprint, on the Users page beside their sessions (owner, 20 October 2026:
// "Sign-in: Face ID / fingerprint after the first password sign-in"; apps/mobile/README.md, Phase 3): an Admin (a Super
// Admin too) sees them and signs them out, all or one ('revoked', written to the audit log); a Super Admin's, only a
// Super Admin (see DeviceCredentialsService.revoke). POST, not DELETE, as for the sessions: nothing is deleted.
@Roles('admin')
@Controller('users/:userId/devices')
export class UserDevicesController {
  constructor(private readonly devices: DeviceCredentialsService) {}

  @Get()
  list(@Param('userId', ParseUUIDPipe) userId: string): Promise<DeviceView[]> {
    return this.devices.listFor(userId);
  }

  /** Signs out every phone of the user: each needs the password again. */
  @Post('revoke')
  @HttpCode(200)
  revokeAll(@Param('userId', ParseUUIDPipe) userId: string, @CurrentUser() user: SessionUser): Promise<{ revoked: number }> {
    return this.devices.revoke(user, userId);
  }

  /** Signs out one of the user's phones. */
  @Post(':deviceId/revoke')
  @HttpCode(200)
  revokeOne(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @CurrentUser() user: SessionUser,
  ): Promise<{ revoked: number }> {
    return this.devices.revoke(user, userId, deviceId);
  }
}
