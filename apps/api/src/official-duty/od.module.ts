import { Global, Module } from '@nestjs/common';
import { CompensatoryModule } from '../compensatory/compensatory.module.js';
import { MyOdController, OdController } from './od.controller.js';
import { OdService } from './od.service.js';

// Official duty, OD (owner, 23 October 2026: "Official duty (OD) requests. The plan has OD as a third attendance mode
// beside Office and WFH, needing an approved request"): the requests, decided by the manager then HR. How an approved
// one counts in the attendance and at check-in is the attendance module's (od-days.ts, read there without this module).
// Global, so the leave import brings official duty rows over with OdService.recordHistory (26 October 2026), as it does
// working from home's. With the compensatory days' module (27 October 2026): one on a rest day or an official holiday
// carries its compensatory day (CompensatoryService), saved and decided with it.
@Global()
@Module({
  imports: [CompensatoryModule],
  controllers: [MyOdController, OdController],
  providers: [OdService],
  exports: [OdService],
})
export class OdModule {}
