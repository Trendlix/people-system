import { Module } from '@nestjs/common';
import { TemplatesController } from './templates.controller.js';
import { TemplatesService } from './templates.service.js';

// Document templates, phase A (spec §8; owner's request, 15 October 2026): the library of Word templates, each slot
// with its versions, uploaded, checked for merge tags and published. Filling them in for an employee comes next.
@Module({
  controllers: [TemplatesController],
  providers: [TemplatesService],
})
export class TemplatesModule {}
