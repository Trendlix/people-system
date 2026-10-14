import { Module } from '@nestjs/common';
import { DepartmentsController } from './departments/departments.controller.js';
import { DepartmentsService } from './departments/departments.service.js';
import { GradesController } from './grades/grades.controller.js';
import { GradesService } from './grades/grades.service.js';
import { JobTitlesController } from './job-titles/job-titles.controller.js';
import { JobTitlesService } from './job-titles/job-titles.service.js';
import { ShiftsController } from './shifts/shifts.controller.js';
import { ShiftsService } from './shifts/shifts.service.js';

// Module 1 · Organisation: departments and their teams, grades, job titles with job descriptions, shifts.
@Module({
  controllers: [DepartmentsController, GradesController, JobTitlesController, ShiftsController],
  providers: [DepartmentsService, GradesService, JobTitlesService, ShiftsService],
})
export class OrganisationModule {}
