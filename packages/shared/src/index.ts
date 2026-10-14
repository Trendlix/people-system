// Values shared by the web app and the API.
// Source of truth: the enums in trendlix-hrms-handoff/db/schema.sql.

export const ROLES = ['employee', 'manager', 'hr', 'finance', 'ceo', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'internship', 'freelance', 'sales'] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const EMPLOYEE_STATUSES = ['active', 'probation', 'on_leave', 'notice_period', 'resigned', 'terminated'] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

export const WORK_ARRANGEMENTS = ['office', 'wfh', 'hybrid'] as const;
export type WorkArrangement = (typeof WORK_ARRANGEMENTS)[number];
