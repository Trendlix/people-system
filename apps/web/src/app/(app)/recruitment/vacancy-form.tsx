'use client';

import Link from 'next/link';
import { EMPLOYMENT_TYPES, KEY_SKILLS_LIMITS, LABELS, PORTFOLIO_MODE_LABELS, PORTFOLIO_MODES, RECRUITMENT_LIMITS, WORK_ARRANGEMENTS, type PortfolioAsk, type VacancyQuestion } from '@trendlix/shared';
import { DateInput } from '@/components/date-time-inputs';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import { RichTextEditor } from '@/components/rich-text-editor';
import { Select } from '@/components/select';
import { formatDate } from '@/lib/format';
import type { FormState } from '@/lib/types';
import { jobTitleAskText, PORTFOLIO_MODE_FIELD } from './portfolio';
import { QuestionsEditor } from './questions-editor';
import { jobTitleName, openingKeySkills } from './cv-fit';
import { KeySkillsField } from './key-skills-field';
import { AGENCY_BACKGROUND_FIELD, AGENCY_BACKGROUND_HINT, agencyBackgroundChoices } from './agency';
import { EXPERIENCE_BASIS_FIELD, EXPERIENCE_BASIS_HINT, experienceBasisChoices } from './career';

// A vacancy's form (owner, 22 October 2026: "where will we include the ATS?"): its job title and title on the careers
// page, the position (grade, hiring manager, headcount, employment type, where the work is done, shift, contract length,
// closing date), the internal salary range (never on the careers page), the public description (filled in from the job
// title's JD) and the screening questions. Once published, the job title and employment type stay, and the questions
// once someone has applied. The API checks every rule again.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;
export type Option = { id: string; label: string };

export interface VacancyDefaults {
  jobTitleId: string;
  title: string;
  gradeId: string;
  hiringManagerId: string;
  headcount: number;
  employmentType: string;
  workArrangement: string;
  shiftId: string;
  durationMonths: number | null;
  closingDate: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  about: string;
  responsibilities: string;
  requirements: string;
  questions: VacancyQuestion[];
  keySkills: string[];
  /** The portfolio its form asks for (owner, 25 October 2026: "Portfolio per position"): '' as the job title, or a mode. */
  portfolioMode: string;
  /** What the job title asks (its setting, else the rule's), when known: said under the choice. */
  jobTitlePortfolio?: PortfolioAsk | null;
  /** Marketing agency background in its CV match (owner, 27 October 2026: "Set per job"): required, preferred or not_needed. */
  agencyBackground: string;
  /** How its CV match counts a CV's years (owner, 29 October 2026: "Set per job"): company or career. */
  experienceBasis: string;
}

const L = RECRUITMENT_LIMITS;
const amount = (n: number | null) => (n === null ? '' : String(n));

export function VacancyForm({
  action,
  defaults,
  options,
  published,
  withQuestions,
  cancelHref,
  submitLabel,
  jobTitleNote,
  suggestKeySkills = false,
}: {
  action: Action;
  defaults: VacancyDefaults;
  options: { jobTitles: Option[]; grades: Option[]; shifts: Option[]; managers: Option[] };
  /** Published: the job title and employment type stay. */
  published: boolean;
  /** The questions can be changed (not once someone applied to a published vacancy). */
  withQuestions: boolean;
  cancelHref: string;
  submitLabel: string;
  /** Under the job title: e.g. how to fill the description from another one. */
  jobTitleNote?: React.ReactNode;
  /** Opened to suggest key skills (?suggest=1, 25 October 2026): with none listed, the chips start with those suggested. */
  suggestKeySkills?: boolean;
}) {
  const { state, form } = useKeptForm(action);
  const fid = useFieldIds();
  const jobTitle = options.jobTitles.find((j) => j.id === defaults.jobTitleId);
  const opening = openingKeySkills(defaults, jobTitleName(jobTitle?.label), suggestKeySkills);

  return (
    <form {...form} className="card max-w-3xl space-y-6 p-6">
      <FormErrors errors={state.errors} />

      <section aria-labelledby={fid('position')} className="space-y-5">
        <h2 id={fid('position')} className="text-lg font-semibold">
          Position
        </h2>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor={fid('jobTitleId')} className="label">
              Job title
            </label>
            {published ? (
              <>
                <input type="hidden" name="jobTitleId" value={defaults.jobTitleId} />
                <p id={fid('jobTitleId')} className="text-sm">
                  {jobTitle?.label ?? '—'}
                </p>
              </>
            ) : (
              <Select id={fid('jobTitleId')} name="jobTitleId" required defaultValue={valueOf(state, 'jobTitleId', defaults.jobTitleId)} className="input">
                <option value="">Choose…</option>
                {options.jobTitles.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.label}
                  </option>
                ))}
              </Select>
            )}
            {jobTitleNote && <p className="hint">{jobTitleNote}</p>}
          </div>
          <div className="sm:col-span-2">
            <label htmlFor={fid('title')} className="label">
              Title on the careers page
            </label>
            <input id={fid('title')} name="title" maxLength={L.title} defaultValue={valueOf(state, 'title', defaults.title)} className="input" />
          </div>
          <div>
            <label htmlFor={fid('employmentType')} className="label">
              Employment type
            </label>
            {published ? (
              <>
                <input type="hidden" name="employmentType" value={defaults.employmentType} />
                <p id={fid('employmentType')} className="text-sm">
                  {LABELS.employmentType[defaults.employmentType as keyof typeof LABELS.employmentType] ?? defaults.employmentType}
                </p>
              </>
            ) : (
              <Select id={fid('employmentType')} name="employmentType" required defaultValue={valueOf(state, 'employmentType', defaults.employmentType)} className="input">
                <option value="">Choose…</option>
                {EMPLOYMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {LABELS.employmentType[t]}
                  </option>
                ))}
              </Select>
            )}
          </div>
          <div>
            <label htmlFor={fid('headcount')} className="label">
              Headcount
            </label>
            <input id={fid('headcount')} name="headcount" type="number" min={1} max={L.headcount} required defaultValue={valueOf(state, 'headcount', String(defaults.headcount))} className="input" />
          </div>
          <div>
            <label htmlFor={fid('workArrangement')} className="label">
              Where the work is done
            </label>
            <Select id={fid('workArrangement')} name="workArrangement" defaultValue={valueOf(state, 'workArrangement', defaults.workArrangement)} className="input">
              {WORK_ARRANGEMENTS.map((w) => (
                <option key={w} value={w}>
                  {LABELS.workArrangement[w]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor={fid('shiftId')} className="label">
              Shift <span className="font-normal text-muted">(optional)</span>
            </label>
            <Select id={fid('shiftId')} name="shiftId" defaultValue={valueOf(state, 'shiftId', defaults.shiftId)} className="input">
              <option value="">None</option>
              {options.shifts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor={fid('gradeId')} className="label">
              Grade <span className="font-normal text-muted">(optional)</span>
            </label>
            <Select id={fid('gradeId')} name="gradeId" defaultValue={valueOf(state, 'gradeId', defaults.gradeId)} className="input">
              <option value="">None</option>
              {options.grades.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor={fid('hiringManagerId')} className="label">
              Hiring manager <span className="font-normal text-muted">(optional)</span>
            </label>
            <Select id={fid('hiringManagerId')} name="hiringManagerId" defaultValue={valueOf(state, 'hiringManagerId', defaults.hiringManagerId)} className="input">
              <option value="">None</option>
              {options.managers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor={fid('durationMonths')} className="label">
              Contract length, months <span className="font-normal text-muted">(optional)</span>
            </label>
            <input
              id={fid('durationMonths')}
              name="durationMonths"
              type="number"
              min={1}
              max={L.durationMonths}
              defaultValue={valueOf(state, 'durationMonths', defaults.durationMonths === null ? '' : String(defaults.durationMonths))}
              className="input"
            />
          </div>
          <div>
            <label htmlFor={fid('closingDate')} className="label">
              Closing date <span className="font-normal text-muted">(optional)</span>
            </label>
            <DateInput id={fid('closingDate')} name="closingDate" defaultValue={valueOf(state, 'closingDate', formatDate(defaults.closingDate))} />
          </div>
        </div>
      </section>

      <section aria-labelledby={fid('salary')} className="space-y-3 border-t border-line pt-6">
        <h2 id={fid('salary')} className="text-lg font-semibold">
          Salary Range
        </h2>
        <p className="text-sm text-muted">For HR, the CEO and a Super Admin only: never on the careers page.</p>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor={fid('salaryMin')} className="label">
              From, EGP a month
            </label>
            <input id={fid('salaryMin')} name="salaryMin" inputMode="decimal" defaultValue={valueOf(state, 'salaryMin', amount(defaults.salaryMin))} className="input" />
          </div>
          <div>
            <label htmlFor={fid('salaryMax')} className="label">
              To, EGP a month
            </label>
            <input id={fid('salaryMax')} name="salaryMax" inputMode="decimal" defaultValue={valueOf(state, 'salaryMax', amount(defaults.salaryMax))} className="input" />
          </div>
        </div>
      </section>

      <section aria-labelledby={fid('description')} className="space-y-5 border-t border-line pt-6">
        <div>
          <h2 id={fid('description')} className="text-lg font-semibold">
            On the Careers Page
          </h2>
          <p className="mt-1 text-sm text-muted">Filled in from the job title&apos;s job description; change it for the advert as you like.</p>
        </div>
        <RichTextEditor name="about" label="About the role" rows={3} defaultValue={valueOf(state, 'about', defaults.about)} />
        <RichTextEditor name="responsibilities" label="Responsibilities" rows={5} defaultValue={valueOf(state, 'responsibilities', defaults.responsibilities)} />
        <RichTextEditor name="requirements" label="Requirements" rows={4} defaultValue={valueOf(state, 'requirements', defaults.requirements)} />
        {/* the portfolio on the application form (owner, 25 October 2026: "Portfolio per position"): the job title's, as
            Recruitment Settings' "Portfolio on the Forms" says, unless this vacancy says otherwise */}
        <div className="max-w-md">
          <label htmlFor={fid('portfolioMode')} className="label">
            Portfolio
          </label>
          <Select
            id={fid('portfolioMode')}
            name={PORTFOLIO_MODE_FIELD}
            defaultValue={valueOf(state, PORTFOLIO_MODE_FIELD, defaults.portfolioMode)}
            aria-describedby={fid('portfolioModeHint')}
            className="input"
          >
            <option value="">As the job title</option>
            {PORTFOLIO_MODES.map((m) => (
              <option key={m} value={m}>
                {PORTFOLIO_MODE_LABELS[m]}
              </option>
            ))}
          </Select>
          <p id={fid('portfolioModeHint')} className="hint">
            {jobTitleAskText(defaults.jobTitlePortfolio) ?? 'As the job title: what Recruitment Settings’ Portfolio on the Forms says for it.'} Optional or Required here
            keep the job title’s kinds and hint (every kind when it asks for none).
          </p>
        </div>
      </section>

      {/* Key skills looked for in each CV (owner, 22 October 2026: "make the OCR egine reads the CV and analyse it"; "Built-in
          rules only"). Unlike the questions, they can change after people applied: every application is scored again. Since
          25 October 2026 ("Full CV fit score") they are one part of the CV fit, as chips HR keeps, removes or adds to, with
          Suggest key skills ("suggest them from its description for HR to confirm"); saved only with the form. */}
      <section aria-labelledby={fid('keySkills')} className="space-y-3 border-t border-line pt-6">
        <div>
          <h2 id={fid('keySkills')} className="text-lg font-semibold">
            Key Skills
          </h2>
          <p className="mt-1 text-sm text-muted">
            Up to {KEY_SKILLS_LIMITS.max}, looked for in each applicant&apos;s CV: with its title, years, requirements, education and agency background they make
            the CV match %. It never filters anyone out. Not shown on the careers page.
          </p>
        </div>
        <KeySkillsField initial={opening.skills} initialNote={opening.note} jobTitles={options.jobTitles} inputId={fid('keySkillsInput')} hintId={fid('keySkillsHint')} />
        {/* marketing agency background in the CV match (owner, 27 October 2026: "i need a flag if the candidate is ex
            marketing agencies or not AND reflectin the scoring"; asked, "Set per job"): Preferred unless chosen */}
        <div className="max-w-md pt-2">
          <label htmlFor={fid('agencyBackground')} className="label">
            Agency background
          </label>
          <Select
            id={fid('agencyBackground')}
            name={AGENCY_BACKGROUND_FIELD}
            defaultValue={valueOf(state, AGENCY_BACKGROUND_FIELD, defaults.agencyBackground)}
            aria-describedby={fid('agencyBackgroundHint')}
            className="input"
          >
            {agencyBackgroundChoices().map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
          <p id={fid('agencyBackgroundHint')} className="hint">
            {AGENCY_BACKGROUND_HINT}
          </p>
        </div>
        {/* how the CV match counts a CV's years (owner, 29 October 2026: "make it career based or company based"; asked,
            "Set per job"): Company based unless chosen */}
        <div className="max-w-md pt-2">
          <label htmlFor={fid('experienceBasis')} className="label">
            Experience counted
          </label>
          <Select
            id={fid('experienceBasis')}
            name={EXPERIENCE_BASIS_FIELD}
            defaultValue={valueOf(state, EXPERIENCE_BASIS_FIELD, defaults.experienceBasis)}
            aria-describedby={fid('experienceBasisHint')}
            className="input"
          >
            {experienceBasisChoices().map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
          <p id={fid('experienceBasisHint')} className="hint">
            {EXPERIENCE_BASIS_HINT}
          </p>
        </div>
      </section>

      <section aria-labelledby={fid('questions')} className="space-y-3 border-t border-line pt-6">
        <div>
          <h2 id={fid('questions')} className="text-lg font-semibold">
            Screening Questions
          </h2>
          <p className="mt-1 text-sm text-muted">
            Asked on the application form. A must-have filters out those who don&apos;t meet it (they are kept, and can be restored); points make the match %.
          </p>
        </div>
        {withQuestions ? (
          <QuestionsEditor initial={defaults.questions} />
        ) : (
          <p className="text-sm text-muted">People have applied already, so the questions stay as they answered them.</p>
        )}
      </section>

      <div className="flex flex-wrap gap-3 border-t border-line pt-6">
        <SubmitButton>{submitLabel}</SubmitButton>
        <Link href={cancelHref} className="btn btn-secondary no-underline">
          Cancel
        </Link>
      </div>
    </form>
  );
}
