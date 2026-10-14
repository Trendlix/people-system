import { Module } from '@nestjs/common';
import { DepartmentsController } from './departments/departments.controller.js';
import { DepartmentsService } from './departments/departments.service.js';
import { JobTitlesController } from './job-titles/job-titles.controller.js';
import { JobTitlesService } from './job-titles/job-titles.service.js';
import { ShiftsController } from './shifts/shifts.controller.js';
import { ShiftsService } from './shifts/shifts.service.js';

// Module 1 · Organisation: departments, job titles with job descriptions, shifts.
@Module({
  controllers: [DepartmentsController, JobTitlesController, ShiftsController],
  providers: [DepartmentsService, JobTitlesService, ShiftsService],
})
export class OrganisationModule {}
