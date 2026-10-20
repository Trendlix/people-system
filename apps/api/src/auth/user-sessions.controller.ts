import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentActiveSession, CurrentUser, Roles } from './decorators.js';
import type { SessionUser } from './session-user.js';
import { SessionsService, type ActiveSession, type SessionView } from './sessions.service.js';

// A user's sessions on the Users page (owner, 20 October 2026: sessions kept on the server, one of each kind a user):
// an Admin (a Super Admin too) sees the ones still open and ends them, all or one ('revoked', written to the audit log);
// a Super Admin's, only a Super Admin (see SessionsService.revoke). POST, not DELETE: nothing is deleted, and every
// DELETE route is a Super Admin's (decorators.ts, DeletesRecords).
@Roles('admin')
@Controller('users/:userId/sessions')
export class UserSessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Get()
  list(@Param('userId', ParseUUIDPipe) userId: string, @CurrentActiveSession() session: ActiveSession): Promise<SessionView[]> {
    return this.sessions.listFor(userId, session.id);
  }

  /** Ends every session the user has open: they are signed out on the website and in the app. */
  @Post('end')
  @HttpCode(200)
  endAll(@Param('userId', ParseUUIDPipe) userId: string, @CurrentUser() user: SessionUser): Promise<{ ended: number }> {
    return this.sessions.revoke(user, userId);
  }

  /** Ends one of the user's sessions. */
  @Post(':sessionId/end')
  @HttpCode(200)
  endOne(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: SessionUser,
  ): Promise<{ ended: number }> {
    return this.sessions.revoke(user, userId, sessionId);
  }
}
