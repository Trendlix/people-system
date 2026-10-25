import { Global, Module } from '@nestjs/common';
import { MeetingHttp } from './meeting-http.js';
import { MeetingTokensService } from './meeting-tokens.service.js';
import { MeetingsController, MeetingSettingsController } from './meetings.controller.js';
import { MeetingsService } from './meetings.service.js';

/**
 * Online interview meetings made by the system (owner, 24 October 2026: "can i link an online meeting service provider
 * to automatically generate meeting links?"; "Google Meet, Microsoft Teams, Zoom"; "make it both"): the providers' apps,
 * the company's and each HR person's connections, and the meetings interviews make, move and delete. Global, so
 * interviews (recruitment) use MeetingsService without wiring this module into theirs; MeetingHttp is the one door to
 * the providers (the tests replace its fetch). MeetingTokensService too, since 25 October 2026: the calendars' busy times
 * (calendars.service.ts) sign in with the Google and Microsoft apps, and read HR's own connections that share them.
 */
@Global()
@Module({ controllers: [MeetingSettingsController, MeetingsController], providers: [MeetingHttp, MeetingTokensService, MeetingsService], exports: [MeetingsService, MeetingHttp, MeetingTokensService] })
export class MeetingsModule {}
