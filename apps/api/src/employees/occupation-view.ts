import { occupationName } from '@trendlix/shared';

/**
 * An employee as the API sends them: with their occupation's name in the social insurance table beside its code, read
 * from the table (occupations.ts), never stored. The occupation is the employee's own, set on the profile's Social
 * Insurance tab (owner's decision, 16 October 2026: no longer their job title's).
 */
export function withOccupation<T extends { occupationCode: string | null }>(employee: T): T & { occupationName: string | null } {
  return { ...employee, occupationName: occupationName(employee.occupationCode) };
}
