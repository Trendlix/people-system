import { Global, Module } from '@nestjs/common';
import { MyWfhController, WfhController } from './wfh.controller.js';
import { WfhService } from './wfh.service.js';

// Working from home (owner, 21 October 2026: "think about how should we handle the working from home in out erp"): the
// requests, HR's recording, the Leave Setup's limits and Zoho People's history. Global, so the leave import can bring
// Zoho's "Working from home" rows over with WfhService.recordHistory without wiring this module in.
@Global()
@Module({
  controllers: [MyWfhController, WfhController],
  providers: [WfhService],
  exports: [WfhService],
})
export class WfhModule {}
