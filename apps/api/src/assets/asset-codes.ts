import type { Prisma } from '../generated/prisma/client.js';

// The next number of a code prefix (spec §2.3: "Generated in the database (a counters table, INSERT … ON CONFLICT …
// RETURNING) so two people saving at once can't collide"): an asset's group and type ("PK-CAM-"), the kits ("PK-KIT-"),
// the custody records ("CUS-"). Called inside the transaction that saves the record with the code: the counter's row
// stays locked until it commits, so a second save of the same prefix waits and gets the next number; one that fails
// rolls its number back with it (no record ever had it). The counter is never lowered, so a deleted or disposed asset's
// code is never given again.

export async function nextCodeNumber(tx: Prisma.TransactionClient, prefix: string): Promise<number> {
  const rows = await tx.$queryRaw<{ last: number }[]>`
    INSERT INTO asset_code_counters (prefix, last) VALUES (${prefix}, 1)
    ON CONFLICT (prefix) DO UPDATE SET last = asset_code_counters.last + 1
    RETURNING last`;
  return Number(rows[0].last);
}
