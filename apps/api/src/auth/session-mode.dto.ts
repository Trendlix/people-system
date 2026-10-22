import { SESSION_MODES, type SessionMode } from '@trendlix/shared';
import { IsIn } from 'class-validator';

/**
 * POST /auth/mode and POST /auth/view-as/mode: how a developer who holds another role uses the system (owner, 22 October
 * 2026: "give hin a switched to use the account as the main role assigned to him or as a developer"): as themselves or as
 * a developer.
 */
export class SessionModeDto {
  @IsIn(SESSION_MODES, { message: 'Choose to use the system as yourself or as a developer.' })
  mode: SessionMode;
}
