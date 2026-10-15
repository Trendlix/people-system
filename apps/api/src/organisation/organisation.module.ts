import { Module } from '@nestjs/common';
import { DepartmentsController } from './departments/departments.controller.js';
import { DepartmentsService } from './departments/departments.service.js';
import { GradesController } from './grades/grades.controller.js';
import { GradesService } from './grades/grades.service.js';
import { JobTitlesController } from './job-titles/job-titles.controller.js';
import { JobTitlesService } from './job-titles/job-titles.service.js';
import { OrgChartController } from './org-chart/org-chart.controller.js';
import { OrgChartService } from './org-chart/org-chart.service.js';
import { ShiftsController } from './shifts/shifts.controller.js';
import { ShiftsService } from './shifts/shifts.service.js';

// Module 1 · Organisation: departments and their teams, grades, job titles with job descriptions, shifts, and the org
// chart drawn from them.
@Module({
  controllers: [DepartmentsController, GradesController, JobTitlesController, OrgChartController, ShiftsController],
  providers: [DepartmentsService, GradesService, JobTitlesService, OrgChartService, ShiftsService],
})
export class OrganisationModule {}
