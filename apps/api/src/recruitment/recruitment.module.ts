import { Global, Module } from '@nestjs/common';
import { ApplicationsService } from './applications.service.js';
import { PublicCareersService } from './public-careers.service.js';
import { RecruitmentOffersService } from './recruitment-offers.service.js';
import { ApplicationsController, PublicCareersController, VacanciesController } from './recruitment.controller.js';
import { VacanciesService } from './vacancies.service.js';

// Recruitment, the ATS, Phase 1 (owner, 22 October 2026: "where will we include the ATS?"): vacancies, the careers page
// and the applicants. Global, so the job offers move an application on (RecruitmentOffersService) without wiring this
// module into theirs; email, notifications and the C-level rules are global too.
@Global()
@Module({
  controllers: [VacanciesController, ApplicationsController, PublicCareersController],
  providers: [VacanciesService, ApplicationsService, PublicCareersService, RecruitmentOffersService],
  exports: [RecruitmentOffersService],
})
export class RecruitmentModule {}
