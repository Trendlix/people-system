import { Global, Module } from '@nestjs/common';
import { ColleagueNamesService } from './colleague-names.service.js';

/**
 * Colleagues by their display names (owner, 31 October 2026), for any module: the answers (ColleagueNamesInterceptor),
 * the phone pushes, the emails and the WhatsApp messages read the same names.
 */
@Global()
@Module({ providers: [ColleagueNamesService], exports: [ColleagueNamesService] })
export class ColleagueNamesModule {}
