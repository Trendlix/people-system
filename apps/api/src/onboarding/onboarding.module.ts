import { Global, Module } from '@nestjs/common';
import { OnboardingController } from './onboarding.controller.js';
import { OnboardingService } from './onboarding.service.js';

// Onboarding (owner, 22 October 2026, the ATS's Phase 2: "onboarding checklist (incl. ID & documents, JD sign-off, KPI
// template assignment)"). Global, so the recruitment's job-offer hooks open a checklist on a hire without wiring this
// module into theirs.
@Global()
@Module({
  controllers: [OnboardingController],
  providers: [OnboardingService],
  exports: [OnboardingService],
})
export class OnboardingModule {}
