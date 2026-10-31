import { Module } from '@nestjs/common';
import { PaperworkModule } from '../paperwork/paperwork.module.js';
import { PhotoRequestsController } from './photo-requests.controller.js';
import { PhotoRequestsService } from './photo-requests.service.js';

// A new photo of themself the employee sends HR (owner, 31 October 2026: "allow them to upload a new photo as a request
// and approved from the HR"). Uses the employee file (paperwork) to add an approved photo as HR's upload of it would be;
// the employee profile lists the employee's own requests (views.ts).
@Module({
  imports: [PaperworkModule],
  controllers: [PhotoRequestsController],
  providers: [PhotoRequestsService],
})
export class PhotoRequestsModule {}
