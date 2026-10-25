import { PrismaPg } from '@prisma/adapter-pg';

// Prisma's PostgreSQL adapter sends a moment as its UTC clock time with no offset, and reads a timestamptz back as if
// its offset were UTC's: right only on a connection that keeps time in UTC. The postgres image on the VPS keeps UTC
// unless told otherwise, but Postgres.app takes the Mac's time zone, Africa/Cairo, so on the development and test
// databases every moment Prisma wrote was kept 3 hours early: read back by Prisma it looked right, while SQL comparing
// it with the database's own moments missed it (26 October 2026: the Audit Log's days, Cairo's, found nothing written
// between Cairo's midnight and 03:00). So every connection keeps time in UTC, whatever the server's own time zone.
/** The adapter for the database at `connectionString`, its sessions in UTC. */
export function pgAdapter(connectionString: string | undefined): PrismaPg {
  return new PrismaPg({ connectionString, options: '-c TimeZone=UTC' });
}
