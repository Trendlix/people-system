// An hour's count of calls, by address and in all, kept in memory (owner's brief, 25 October 2026: the CV read on the
// careers forms "about 20 an hour per address", and LinkedIn's sign-in): nothing about the calls is written anywhere,
// since what they carry (a CV, a sign-in) is never kept. Each address's calls of the last hour, by their times; a
// restart of the API forgets them, which only ever lets a few more through.

export class HourlyWindow {
  private readonly byAddress = new Map<string, number[]>();
  private all: number[] = [];

  constructor(
    private readonly perAddress: number,
    private readonly perHourAll: number,
  ) {}

  /** Whether one more call from `address` is allowed in the last hour (and counts it when it is). */
  allow(address: string | null, now = Date.now()): boolean {
    const since = now - 60 * 60 * 1000;
    this.all = this.all.filter((t) => t > since);
    const key = address || 'unknown';
    const mine = (this.byAddress.get(key) ?? []).filter((t) => t > since);
    if (mine.length >= this.perAddress || this.all.length >= this.perHourAll) {
      this.byAddress.set(key, mine);
      return false;
    }
    mine.push(now);
    this.byAddress.set(key, mine);
    this.all.push(now);
    // an address quiet for an hour is forgotten
    if (this.byAddress.size > 5000) for (const [k, times] of this.byAddress) if (!times.some((t) => t > since)) this.byAddress.delete(k);
    return true;
  }
}
