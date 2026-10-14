// PostgreSQL `time` columns come through Prisma as Dates on 1970-01-01 (UTC).
// These helpers convert between that and "HH:mm" strings.

export const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;

export function toTimeOfDay(hhmm: string): Date {
  return new Date(`1970-01-01T${hhmm}:00.000Z`);
}

export function fromTimeOfDay(value: Date): string {
  return value.toISOString().slice(11, 16);
}
