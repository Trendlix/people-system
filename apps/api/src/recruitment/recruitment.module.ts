import { Global, Module } from '@nestjs/common';
import { ApplicationsService } from './applications.service.js';
import { CvReadingsService } from './cv-readings.service.js';
import { CvUploadsService } from './cv-uploads.service.js';
import { ApplicantsSummaryController, CvUploadsController, GeneralCvsController, PublicGeneralCvsController } from './general-cvs.controller.js';
import { GeneralCvsService } from './general-cvs.service.js';
import { PublicCareersService } from './public-careers.service.js';
import { RecruitmentOffersService } from './recruitment-offers.service.js';
import { InterviewsService } from './interviews.service.js';
import { RecruitmentAnalyticsService } from './recruitment-analytics.service.js';
import { RecruitmentSchedulerService } from './recruitment-scheduler.service.js';
import { RecruitmentSettingsService } from './recruitment-settings.service.js';
import { OcrClient } from '../paperwork/ocr.client.js';
import {
  ApplicationsController,
  BoardController,
  InterviewsController,
  MyHiringController,
  PublicCareersController,
  RecruitmentAnalyticsController,
  RecruitmentSettingsController,
  VacanciesController,
} from './recruitment.controller.js';
import { VacanciesService } from './vacancies.service.js';

// Recruitment, the ATS (owner, 22 October 2026: "where will we include the ATS?"): Phase 1, vacancies, the careers page
// and the applicants; Phase 2, the pipeline board, interviews, scorecards, the hiring manager's suggestions, the
// rejection email, Recruitment Settings, the analytics and the scorecard reminder's round. Global, so the job offers move an application on (RecruitmentOffersService) without wiring this
// module into theirs; email, notifications and the C-level rules are global too.
@Global()
@Module({
  controllers: [
    VacanciesController,
    BoardController,
    ApplicationsController,
    InterviewsController,
    MyHiringController,
    RecruitmentSettingsController,
    RecruitmentAnalyticsController,
    PublicCareersController,
    // general CVs, the Applicants page's summary and the bulk upload (22 October 2026)
    GeneralCvsController,
    ApplicantsSummaryController,
    CvUploadsController,
    PublicGeneralCvsController,
  ],
  providers: [
    VacanciesService,
    ApplicationsService,
    PublicCareersService,
    RecruitmentOffersService,
    InterviewsService,
    RecruitmentSettingsService,
    RecruitmentAnalyticsService,
    RecruitmentSchedulerService,
    GeneralCvsService,
    CvUploadsService,
    // every CV read and analysed in the background (22 October 2026: "make the OCR egine reads the CV and analyse it")
    CvReadingsService,
    OcrClient,
  ],
  exports: [RecruitmentOffersService, InterviewsService, RecruitmentSchedulerService, CvReadingsService],
})
export class RecruitmentModule {}
