import { Module } from '@nestjs/common';
import { STARTER_LAYOUTS, STARTER_LAYOUTS_TOKEN } from './starter-layouts.js';
import { TemplatesController } from './templates.controller.js';
import { TemplatesService } from './templates.service.js';

// Document templates, phase A (spec §8; owner's request, 15 October 2026): the library of Word templates, each slot
// with its versions, uploaded, checked for merge tags and published. Filling them in for an employee comes next. A
// version may also be a PDF form with its fields placed on it (owner's decision, 15 October 2026); the starter layouts
// of the forms the system knows are given through a token, so a test can give its own.
@Module({
  controllers: [TemplatesController],
  providers: [TemplatesService, { provide: STARTER_LAYOUTS_TOKEN, useValue: STARTER_LAYOUTS }],
})
export class TemplatesModule {}
