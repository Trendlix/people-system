import type { Role } from '@trendlix/shared';
import type { SessionUser } from '../auth/session-user.js';

// Who sees which employees and which restricted fields (spec §1). Managers and employees are matched to their own
// employee record by work email: a sign-in account whose email is an employee's work email is that employee.

const has = (user: SessionUser, roles: Role[]) => user.roles.some((r) => roles.includes(r));

/** HR, CEO and Finance see every employee. Managers see themselves and their direct reports; anyone else, themselves. */
export const seesEveryone = (user: SessionUser) => has(user, ['hr', 'ceo', 'finance']);

/** National ID: HR and CEO. */
export const seesIdentity = (user: SessionUser) => has(user, ['hr', 'ceo']);

/** Bank and payment: HR, Finance and CEO. */
export const seesBank = (user: SessionUser) => has(user, ['hr', 'finance', 'ceo']);

/** Only HR adds and changes employees. */
export const editsEmployees = (user: SessionUser) => has(user, ['hr']);

/** HR and Admin (the top role) can delete an employee record, e.g. one added by mistake. */
export const deletesEmployees = (user: SessionUser) => has(user, ['hr', 'admin']);
