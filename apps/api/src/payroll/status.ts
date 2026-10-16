import type { PayrollStatus } from '@trendlix/shared';

/** How a run's status reads in a message: "The October 2026 payroll is with the CEO, …". */
export const STATUS_TEXT: Record<PayrollStatus, string> = { draft: 'is a draft', pending_ceo: 'is with the CEO', approved: 'is approved', paid: 'is marked paid' };
