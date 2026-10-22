import { assetSerialKey } from '@trendlix/shared';
import type { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';

// One serial number, one item (owner, 22 October 2026: "same serial number shouldn't be added twice"). A serial is
// compared by its key (packages/shared assetSerialKey: "abc-123" and "ABC 123" alike), kept beside it on the asset and
// on an accessory's line (serial_key). A new or changed serial is refused when another asset, another asset's
// accessory, or another of Claude's open drafts has it; checked again under a lock in the transaction that saves it, so
// two people saving the same serial at once can't both pass. Serials kept twice before this rule stay as they are
// until one of them changes (no unique index: the migration couldn't have made one over them).

/** The lock the saves of serials hold, one at a time. */
const SERIAL_LOCK = 'people-system asset serials';

type Db = PrismaService | Prisma.TransactionClient;

/** Holds the serials' lock until the transaction ends. */
export const lockSerials = (tx: Prisma.TransactionClient) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${SERIAL_LOCK}))`;

/**
 * Where else a serial is looked for: not on `asset` (the one being saved) nor on its own accessories; `ownSerial`, its
 * own serial as kept, which its accessories' lines may not repeat (not looked up: it is saved already).
 */
export interface SerialScope {
  asset?: string;
  ownSerial?: string | null;
}

/**
 * Where a serial is already, in words ("on PK-CAM-0003 · Sony FX6"), or null when nowhere else: an asset's own serial
 * first, else an accessory's line of another asset.
 */
export async function serialFoundOn(db: Db, serial: string | null | undefined, scope: SerialScope = {}): Promise<string | null> {
  const key = assetSerialKey(serial);
  if (!key) return null;
  const asset = await db.asset.findFirst({
    where: { serialKey: key, ...(scope.asset && { id: { not: scope.asset } }) },
    orderBy: { code: 'asc' },
    select: { code: true, name: true, status: true },
  });
  if (asset) return `on ${asset.code} · ${asset.name}${asset.status === 'disposed' ? ' (disposed)' : ''}`;
  const line = await db.assetAccessory.findFirst({
    where: { serialKey: key, ...(scope.asset && { assetId: { not: scope.asset } }) },
    orderBy: { asset: { code: 'asc' } },
    select: { name: true, asset: { select: { code: true, name: true } } },
  });
  return line ? `on ${line.asset.code} · ${line.asset.name}, as its accessory ${line.name}` : null;
}

/**
 * Every problem with the serials being saved, in words (none: they may be saved): the asset's own (`serial`) and its
 * accessories' lines', each against the other assets and their accessories.
 */
export async function serialProblems(
  db: Db,
  serial: string | null | undefined,
  accessories: readonly { name: string; serial: string | null }[],
  scope: SerialScope = {},
): Promise<string[]> {
  const out: string[] = [];
  const own = await serialFoundOn(db, serial, scope);
  if (own) out.push(`Serial number ${serial!.trim()} is already ${own}.`);
  const ownKey = assetSerialKey(serial ?? scope.ownSerial);
  for (const [i, a] of accessories.entries()) {
    if (!a.serial) continue;
    const which = a.name ? `Accessory ${i + 1} (${a.name})` : `Accessory ${i + 1}`;
    if (ownKey && assetSerialKey(a.serial) === ownKey) {
      out.push(`${which}: its serial number is the asset’s own.`);
      continue;
    }
    const found = await serialFoundOn(db, a.serial, scope);
    if (found) out.push(`${which}: serial number ${a.serial.trim()} is already ${found}.`);
  }
  return out;
}
