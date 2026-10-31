import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/decorators.js';
import { AppReleasesService } from './app-releases.service.js';

// The app asks on opening and coming back whether it is the newest build; an older one shows only "Update required"
// (owner, 31 October 2026: "Always the latest build"). Public: the sign-in screen is held back too.
@Controller('app')
export class AppReleasesController {
  constructor(private readonly releases: AppReleasesService) {}

  /**
   * The app's newest build: { version: "0.6.15", publishedAt, downloadUrl, removeOldFirst }; version null when it can't
   * be told. removeOldFirst: the app says to remove the old version before installing (until it's in the stores).
   */
  @Public()
  @Get('latest')
  latest() {
    return this.releases.latest();
  }
}
