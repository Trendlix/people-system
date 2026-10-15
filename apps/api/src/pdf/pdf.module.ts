import { Global, Module } from '@nestjs/common';
import { PdfService } from './pdf.service.js';

/** Word to PDF, for any module (see PdfService). */
@Global()
@Module({ providers: [PdfService], exports: [PdfService] })
export class PdfModule {}
