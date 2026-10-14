import { Module } from '@nestjs/common';
import { OcrClient } from './ocr.client.js';
import { EmployeePaperworkController, PaperworkController } from './paperwork.controller.js';
import { PaperworkService } from './paperwork.service.js';

// Module 2 · Employee file (spec §8.5): scanned paperwork kept with its text, read by the OCR service; search over
// that text; and national ID cards read into suggestions for the identity form.
@Module({
  controllers: [EmployeePaperworkController, PaperworkController],
  providers: [PaperworkService, OcrClient],
})
export class PaperworkModule {}
