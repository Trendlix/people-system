import { Module } from '@nestjs/common';
import { AllowancesModule } from '../allowances/allowances.module.js';
import { OfferDocumentsService } from './offer-documents.service.js';
import { OfferHiringService } from './offer-hiring.service.js';
import { OffersController, PublicOffersController } from './offers.controller.js';
import { OffersService } from './offers.service.js';
import { PublicOffersService } from './public-offers.service.js';

// Job offers: drafted, sent (by email or as a link), answered by the candidate on the offer's page, and turned into a
// profile, an employment and a draft contract once accepted. Uses the allowances module for the allowances' kinds;
// email and the PDF converter are global (MailModule, PdfModule).
@Module({
  imports: [AllowancesModule],
  controllers: [OffersController, PublicOffersController],
  providers: [OffersService, PublicOffersService, OfferDocumentsService, OfferHiringService],
})
export class OffersModule {}
