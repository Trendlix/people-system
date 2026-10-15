import { Module } from '@nestjs/common';
import { DocumentsController, EmployeeDocumentsController } from './documents.controller.js';
import { DocumentsService } from './documents.service.js';

// Document templates, phase B (spec §8.3–8.4; owner's request, 15 October 2026): filling the published templates in
// for an employee, on the profile's Contracts tab, and each document's lifecycle (generated, printed, signed copy
// uploaded, verified). The filling itself is engine/.
@Module({
  controllers: [EmployeeDocumentsController, DocumentsController],
  providers: [DocumentsService],
})
export class DocumentsModule {}
