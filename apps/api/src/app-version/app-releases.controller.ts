import { Controller, Get, Headers } from '@nestjs/common';
import { Public } from '../auth/decorators.js';
import { latestFor } from './app-releases.js';
import { AppReleasesService } from './app-releases.service.js';

// The app asks on opening and coming back whether it is the newest build; an older one shows only "Update required"
// (owner, 31 October 2026: "Always the latest build"). Public: the sign-in screen is held back too.
@Controller('app')
export class AppReleasesController {
  constructor(private readonly releases: AppReleasesService) {}

  /**
   * The app's newest build: { version: "0.6.15", publishedAt, downloadUrl, removeOldFirst }; version null when it can't
   * be told. removeOldFirst: the app says to remove the old version before installing, only when the phone's build (its
   * user agent's version) isn't signed with the newest one's key (removeOldFirstFor).
   */
  @Public()
  @Get('latest')
  async latest(@Headers('user-agent') userAgent?: string) {
    return latestFor(await this.releases.latest(), userAgent);
  }
}
