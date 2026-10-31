import { Injectable, Logger } from '@nestjs/common';
import { colleagueNameSwap, type NamedPerson } from '@trendlix/shared';
import { PrismaService } from '../prisma/prisma.service.js';

/** How long the people's names are kept: a new person, or a display name changed, shows within a minute. */
const PEOPLE_TTL_MS = 60_000;

const SAME = (text: string) => text;

/**
 * Everyone's names for colleagues' display names (owner, 31 October 2026: "for employees, make them see their coleagues
 * display names, not full names"; packages/shared colleague-names.ts): the employees' full names and display names, read
 * a minute at a time, and each viewer's swap made once a minute. If the names can't be read, the text is left as it is
 * (logged): a page still answers, with full names, rather than fail.
 */
@Injectable()
export class ColleagueNamesService {
  private readonly logger = new Logger(ColleagueNamesService.name);
  private people: { at: number; value: Promise<NamedPerson[]>; swaps: Map<string, (text: string) => string> } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** The swap of colleagues' full names for their display names, for the person `selfId` (their own name stays). */
  async swapFor(selfId: string | null | undefined): Promise<(text: string) => string> {
    const now = Date.now();
    if (!this.people || now - this.people.at > PEOPLE_TTL_MS) {
      this.people = { at: now, value: this.prisma.employee.findMany({ select: { id: true, fullNameEn: true, fullNameAr: true, displayName: true } }), swaps: new Map() };
    }
    const held = this.people;
    try {
      const people = await held.value;
      const key = selfId ?? '';
      let swap = held.swaps.get(key);
      if (!swap) held.swaps.set(key, (swap = colleagueNameSwap(people, selfId)));
      return swap;
    } catch (err) {
      if (this.people === held) this.people = null;
      this.logger.warn(`The names for colleagues' display names could not be read: ${(err as Error).message}`);
      return SAME;
    }
  }
}
