import { AgencyMarksController } from './agency-marks.controller.js';
import { AgencyMarksService } from './agency-marks.service.js';
import { Global, Module } from '@nestjs/common';
import { ApplicationsService } from './applications.service.js';
import { CandidatesController } from './candidates.controller.js';
import { CandidatesService } from './candidates.service.js';
import { CvReadingsService } from './cv-readings.service.js';
import { CvUploadsService } from './cv-uploads.service.js';
import { ApplicantsSummaryController, CvUploadsController, GeneralCvsController, PublicGeneralCvsController } from './general-cvs.controller.js';
import { GeneralCvsService } from './general-cvs.service.js';
import { PublicCareersService } from './public-careers.service.js';
import { RecruitmentDeletesService } from './recruitment-deletes.service.js';
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
import { CvPreviewsService } from './cv-previews.service.js';
import { ScreeningCommentsController } from './screening-comments.controller.js';
import { ScreeningCommentsService } from './screening-comments.service.js';
import { KeySkillsController, SuggestionsController, VacancySuggestionsController } from './vacancy-suggestions.controller.js';
import { CvFitsService } from './cv-fits.service.js';
import { VacancySuggestionsService } from './vacancy-suggestions.service.js';
import { CareersExtrasController, CareersSettingsController, PortfolioFilesController } from './careers-extras.controller.js';
import { CvPrefillService } from './cv-prefill.service.js';
import { LinkedInHttp } from './linkedin-http.js';
import { LinkedInSignInService } from './linkedin-signin.service.js';
import { PortfolioSettingsService } from './portfolio-settings.service.js';

// Recruitment, the ATS (owner, 22 October 2026: "where will we include the ATS?"): Phase 1, vacancies, the careers page
// and the applicants; Phase 2, the pipeline board, interviews, scorecards, the hiring manager's suggestions, the
// rejection email, Recruitment Settings, the analytics and the scorecard reminder's round. Global, so the job offers move an application on (RecruitmentOffersService) without wiring this
// module into theirs; email, notifications and the C-level rules are global too.
@Global()
@Module({
  controllers: [
    // HR's list of marketing agencies (27 October 2026: "Name words + your list")
    AgencyMarksController,
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
    // candidate profiles (owner, 22 October 2026: "how to make like a profile for each candidate …")
    CandidatesController,
    // screening comments with a verdict (owner, 24 October 2026: "is there a way to add screening comments?")
    ScreeningCommentsController,
    // Suggested From Earlier CVs on each open vacancy (owner, 24 October 2026: "Suggest; HR adds")
    VacancySuggestionsController,
    SuggestionsController,
    // the key skills suggested from a vacancy's texts (owner, 25 October 2026: "Full CV fit score")
    KeySkillsController,
    // the careers forms filled in from the CV, "Fill in with LinkedIn" and a portfolio per position (25 October 2026)
    CareersExtrasController,
    CareersSettingsController,
    PortfolioFilesController,
  ],
  providers: [
    AgencyMarksService,
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
    // the other open positions a CV fits, kept with each vacancy's suggestions (25 October 2026: "and if it recomended to
    // another position based on the CV")
    CvFitsService,
    // one profile per candidate, the backfill started by main.ts (22 October 2026)
    CandidatesService,
    // screening comments, and the CVs as PDFs for the CV window (24 October 2026: "open it in a popup window")
    ScreeningCommentsService,
    CvPreviewsService,
    // the careers forms filled in from the CV, "Fill in with LinkedIn" and a portfolio per position (25 October 2026)
    CvPrefillService,
    LinkedInHttp,
    LinkedInSignInService,
    PortfolioSettingsService,
    // the earlier CVs matched with each open vacancy, HR told of new matches (24 October 2026: "Suggest; HR adds")
    VacancySuggestionsService,
    // a Super Admin deletes an applicant, or a vacancy with its applicants (owner, 25 October 2026: "Vacancy alone -
    // applicant alone - superadmin only")
    RecruitmentDeletesService,
  ],
  exports: [RecruitmentOffersService, InterviewsService, RecruitmentSchedulerService, CvReadingsService, CandidatesService, ScreeningCommentsService],
})
export class RecruitmentModule {}
