import { INTERN_DEFAULT_MONTHS, isTrainingType } from '@trendlix/shared';
import type { ContractSettings } from '../../../../../lib/types';
import type { ContractDefaults } from './contract-form';

// What an employment's first contract starts with: on Add employment, below the job (hiring in one form, owner's
// decision, 16 October 2026), and on New contract for an employment without one. Pure code, tested; relative imports,
// as vitest doesn't know the @/ paths.

/** The basic share of the gross before the company had a default of its own (Payroll Setup). */
const BASIC_PERCENT = 80;

/**
 * The first contract's defaults: fixed-term for the settings' length, their probation, none for someone employed here
 * before (probation comes once with an employer, Labour Law Art. 90), the company's basic share, and a monthly salary
 * still to type (a trainee's training stages too). For the employment's type when it is known (`employmentType`; hiring
 * in one form, it is chosen there): a trainee's or an intern's agreement has no probation, and an intern's runs for 3
 * months unless HR chooses another (owner, 19 October 2026).
 * `startDate` is YYYY-MM-DD, or '' when it is the join date still to be typed.
 */
export function firstContractDefaults(settings: ContractSettings, startDate: string, employedBefore: boolean, employmentType = ''): ContractDefaults {
  return {
    startDate,
    // fixed-term for the settings' months stays the default (owner, 18 October 2026)
    form: 'fixed',
    durationMonths: employmentType === 'intern' ? INTERN_DEFAULT_MONTHS : settings.durationMonths,
    jobToDo: '',
    endDate: '',
    probationMonths: employedBefore || isTrainingType(employmentType) ? 0 : settings.probationMonths,
    traineeStages: null,
    payBasis: 'monthly',
    grossSalary: null,
    hourlyRate: null,
    hoursPerWeek: null,
    daysPerWeek: null,
    basicPercent: settings.basicPercentDefault ?? BASIC_PERCENT,
    netSalary: null,
    allowances: [],
    note: '',
  };
}

/** Why the probation of someone employed here before starts at 0. */
export const noProbationAgain = (name: string) =>
  `0: ${name} was employed here before, and probation comes only once with an employer (Labour Law Art. 90).`;
