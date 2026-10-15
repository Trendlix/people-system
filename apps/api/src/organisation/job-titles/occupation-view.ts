import { occupationName } from '@trendlix/shared';

/**
 * A job title as the API sends it: with its occupation's name in the social insurance table beside its code (owner, 15
 * October 2026), read from the table (occupations.ts), never stored. The job titles send it, and so does the employee
 * profile for its employments' job titles, which the Social Insurance tab shows (owner, 16 October 2026).
 */
export function withOccupation<T extends { occupationCode: string | null }>(job: T): T & { occupationName: string | null } {
  return { ...job, occupationName: occupationName(job.occupationCode) };
}
