import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/decorators.js';

// Which code the server runs, so a deploy can be confirmed from outside: the last commit that changed what the
// image is built from, and its date. deploy/deploy.sh works both out and the image carries them; a build made
// by hand without them answers with nulls.
@Controller('version')
export class VersionController {
  @Public()
  @Get()
  version() {
    return {
      commit: process.env.PEOPLE_COMMIT || null,
      committed: process.env.PEOPLE_COMMITTED || null,
    };
  }
}
