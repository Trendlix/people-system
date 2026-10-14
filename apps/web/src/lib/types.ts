import type { Role } from '@trendlix/shared';

// Shapes returned by the API.

export interface SessionUser {
  id: string;
  email: string;
  roles: Role[];
}

export interface Department {
  id: string;
  nameEn: string;
  nameAr: string | null;
  _count: { jobTitles: number };
}

export interface JobTitleSummary {
  id: string;
  departmentId: string;
  titleEn: string;
  titleAr: string | null;
  grade: string | null;
  jdVersion: number;
  department: { id: string; nameEn: string; nameAr: string | null };
  _count: { duties: number };
}

export interface JobTitle extends Omit<JobTitleSummary, '_count'> {
  jdPurpose: string | null;
  jdRequirements: string | null;
  duties: { id: string; position: number; duty: string }[];
}

export interface Shift {
  id: string;
  code: string;
  startTime: string;
  endTime: string;
  graceMinutes: number;
  workingDays: number[];
}

/** Returned by every form action. */
export interface FormState {
  errors?: string[];
  values?: Record<string, string | string[]>;
}
