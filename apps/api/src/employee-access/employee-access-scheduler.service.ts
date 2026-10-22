import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { EmployeeAccessService } from './employee-access.service.js';

// The sweep that makes the accounts of active employees with active contracts (owner, 22 October 2026: "any active
// employee with active contract should have access"), every few minutes, so a hire, a signed contract, a renewal or a
// changed email is never missed. Nothing is sent: HR sends the invitations. Started by main.ts once the API listens
// (the tests run it by hand); the timer never keeps the process alive.

export const ACCESS_TICK_MINUTES = 5;

@Injectable()
export class EmployeeAccessSchedulerService implements OnModuleDestroy {
  private readonly logger = new Logger('EmployeeAccessRound');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly access: EmployeeAccessService) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), ACCESS_TICK_MINUTES * 60_000);
    this.timer.unref();
    void this.tick();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One sweep, unless the last is still going. Never throws. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.access.sweep();
    } catch (err) {
      this.logger.error(`The access sweep could not run: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
