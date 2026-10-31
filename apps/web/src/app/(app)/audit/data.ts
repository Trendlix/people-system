import 'server-only';
import { loadJson, type Loaded } from '../payroll/load';
import { apiAuditPath, apiSignInsPath, type AuditFilters, type AuditOptions, type AuditPage, type SignInFilters, type SignInsPage } from './audit';

// Loading the Audit Log (owner, 19 October 2026: "an Audit Log page showing who changed what and when"): a page of the
// entries with the filters, and what the filters offer. An API from before it answers 404 ("not available yet"); a
// refusal (403: only the Super Admin and the CEO) and any other failure are shown in the page's place.

export type { Loaded };

/** GET /audit with the filters and the page. */
export const loadAuditPage = (filters: AuditFilters): Promise<Loaded<AuditPage>> => loadJson<AuditPage>(apiAuditPath(filters));

/** GET /audit/options: the users, actions, kinds of record and people the filters list. */
export const loadAuditOptions = (): Promise<Loaded<AuditOptions>> => loadJson<AuditOptions>('/audit/options');

/** GET /audit/sign-ins with the filters and the page (31 October 2026). */
export const loadSignIns = (filters: SignInFilters): Promise<Loaded<SignInsPage>> => loadJson<SignInsPage>(apiSignInsPath(filters));
