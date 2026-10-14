import { Module } from '@nestjs/common';
import { CorrectionsService } from './corrections.service.js';
import { IdCardController } from './id-card.controller.js';
import { OcrClient } from './ocr.client.js';
import { EmployeePaperworkController, PaperworkController } from './paperwork.controller.js';
import { PaperworkService } from './paperwork.service.js';

// Module 2 · Employee file (spec §8.5): scanned paperwork kept with its text, read by the OCR service; search over
// that text; and national ID cards found on a scan, read into suggestions for the identity form, and corrected
// readings learned from.
@Module({
  controllers: [EmployeePaperworkController, PaperworkController, IdCardController],
  providers: [PaperworkService, CorrectionsService, OcrClient],
})
export class PaperworkModule {}
