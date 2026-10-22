import {
  applyProblems,
  emailProblem,
  generalCvProblems,
  mobileProblem,
  noticeOf,
  noticeProblem,
  sourceOf,
  webLinkOf,
  yearsProblem,
  type ApplicationSource,
  type ApplyInput,
  type GeneralCvInput,
  type PublicQuestion,
  type VacancyQuestion,
} from '@trendlix/shared';

// The careers page (owner, 22 October 2026: "where will we include the ATS?"; people.trendlix.com/careers: "i dont know
// how to decide it for now"): reading its application form and passing it on to the API. Pure code (relative imports),
// tested in careers.test.ts; the API checks every rule again. Its email, mobile, years and notice period (22 October
// 2026, on an iPhone: "make the years of experience field only numbers"; the notice period "in Days" … "and a selectoor
// to make it months"; the mobile "like the one applied in the system, country code and no extra zero"; "validate email
// field") are checked in the page as well, under each field, before the form is sent (fieldProblems).

export const CAREERS_PATH = '/careers';
export const jobHref = (slug: string, source?: ApplicationSource) => (source && source !== 'careers' ? `/careers/${slug}?src=${source}` : `/careers/${slug}`);

/** The form field of a question's answer. */
export const answerField = (key: string) => `answer-${key}`;

/** The honeypot: a field hidden from people, so only a robot fills it. */
export const HONEYPOT = 'website';

const text = (fd: FormData, name: string): string => {
  const v = fd.get(name);
  return typeof v === 'string' ? v.trim() : '';
};

/** A question as the rules read it: the careers page's carries no scoring, which the rules don't need to check answers. */
const asRules = (q: PublicQuestion): VacancyQuestion => ({
  key: q.key,
  kind: q.kind,
  text: q.text,
  required: q.required,
  knockout: false,
  ...(q.kind === 'choice' && { options: (q.options ?? []).map((label) => ({ label, points: 0, accepted: true })) }),
});

/** The answers typed, by question key. */
export function answersFrom(fd: FormData, questions: readonly PublicQuestion[]): Record<string, string> {
  return Object.fromEntries(questions.map((q) => [q.key, text(fd, answerField(q.key))]));
}

/** The person's fields, as the forms name them: the mobile as kept (PhoneInput's hidden field), the notice period's number and unit (NoticeInput's). */
const PERSON_FIELDS = ['fullName', 'email', 'mobile', 'linkedin', 'portfolio', 'yearsExperience', 'noticeNumber', 'noticeUnit', 'expectedSalary'] as const;

/** The fields sent to the API as typed (the notice period goes as one, noticeFrom). */
const SENT_FIELDS = ['fullName', 'email', 'mobile', 'linkedin', 'portfolio', 'yearsExperience', 'expectedSalary'] as const;

/** The notice period as kept, "30 days" or "2 months", from the form's number and unit; null without a number. */
export const noticeFrom = (fd: FormData): string | null => noticeOf(text(fd, 'noticeNumber'), text(fd, 'noticeUnit'));

/** What was typed, kept to show again after a refusal (never the CV). */
export function typedValues(fd: FormData, questions: readonly PublicQuestion[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of PERSON_FIELDS) out[name] = text(fd, name);
  for (const q of questions) out[answerField(q.key)] = text(fd, answerField(q.key));
  if (fd.get('consent')) out.consent = 'on';
  return out;
}

const numberOf = (t: string): number | null => (t === '' ? null : Number(t.replace(/,/g, '')));

/** The application as the rules check it: what the page can say before sending (the API says the rest). */
export function applyInputOf(fd: FormData, questions: readonly PublicQuestion[]): ApplyInput {
  return {
    fullName: text(fd, 'fullName'),
    email: text(fd, 'email'),
    mobile: text(fd, 'mobile'),
    linkedin: webLinkOf(text(fd, 'linkedin')) || null,
    portfolio: webLinkOf(text(fd, 'portfolio')) || null,
    yearsExperience: numberOf(text(fd, 'yearsExperience')),
    noticePeriod: noticeFrom(fd),
    expectedSalary: numberOf(text(fd, 'expectedSalary')),
    answers: answersFrom(fd, questions),
    consent: fd.get('consent') !== null,
  };
}

/** The years of experience, asked on a job's form (the general form's are optional). */
export const YEARS_REQUIRED = 'Write your years of experience as a number, e.g. 3.';

/** What is wrong with the form before it is sent, in words (the CV's checks are the API's). */
export function applyFormProblems(fd: FormData, questions: readonly PublicQuestion[]): string[] {
  const problems = applyProblems(applyInputOf(fd, questions), questions.map(asRules));
  if (!text(fd, 'yearsExperience')) problems.push(YEARS_REQUIRED);
  const cv = fd.get('cv');
  if (!(cv instanceof Blob) || cv.size === 0) problems.push('Attach your CV, as a PDF or a Word file.');
  return problems;
}

/**
 * The form as the API takes it (POST /public/careers/:slug/apply): the fields as text, the answers as JSON, the
 * channel it came by, where it came from, and the CV.
 */
export function apiForm(fd: FormData, questions: readonly PublicQuestion[], from: { source: string | null; ip?: string; userAgent?: string }): FormData {
  const out = personForm(fd);
  out.set('answers', JSON.stringify(answersFrom(fd, questions)));
  if (fd.get('consent') !== null) out.set('consent', 'true');
  out.set('source', sourceOf(from.source));
  const honeypot = text(fd, HONEYPOT);
  if (honeypot) out.set(HONEYPOT, honeypot);
  if (from.ip) out.set('ip', from.ip);
  if (from.userAgent) out.set('userAgent', from.userAgent);
  const cv = fd.get('cv');
  if (cv instanceof Blob && cv.size > 0) out.set('cv', cv, cv instanceof File ? cv.name : 'cv');
  return out;
}

/** The person's fields as the API takes them: as typed, the notice period as one ("30 days"). */
function personForm(fd: FormData): FormData {
  const out = new FormData();
  for (const name of SENT_FIELDS) {
    const v = text(fd, name);
    if (v) out.set(name, v);
  }
  const notice = noticeFrom(fd);
  if (notice) out.set('noticePeriod', notice);
  return out;
}

// ---------- the fields checked in the page (22 October 2026) ----------

/** The fields the page checks as they are left and before sending, in the form's order; each named by its box's id. */
export type CheckedField = 'email' | 'mobile' | 'yearsExperience' | 'noticePeriod';

/**
 * What is wrong with the email, mobile, years and notice period, each under its field, in the form's order (the first
 * gets the focus): the rules the API checks (@trendlix/shared). The years are asked on a job's form (`yearsRequired`).
 */
export function fieldProblems(fd: FormData, { yearsRequired }: { yearsRequired: boolean }): { field: CheckedField; message: string }[] {
  const years = text(fd, 'yearsExperience');
  const said: [CheckedField, string | null][] = [
    ['email', emailProblem(text(fd, 'email'))],
    ['mobile', mobileProblem(text(fd, 'mobile'))],
    ['yearsExperience', years ? yearsProblem(numberOf(years)) : yearsRequired ? YEARS_REQUIRED : null],
    ['noticePeriod', noticeProblem(noticeFrom(fd))],
  ];
  return said.filter((s): s is [CheckedField, string] => s[1] !== null).map(([field, message]) => ({ field, message }));
}

/** "Full-time · Hybrid (office and home) · Production", the job's facts in a line. */
export const factsLine = (parts: readonly (string | null | undefined)[]) => parts.filter((p): p is string => !!p).join(' · ');

// ---------- "Send us your CV" (22 October 2026: "what came out of the posted jobs and what cam on randomly") ----------

export const GENERAL_PATH = '/careers/general';

/** The general form's area field: a department's id, or OTHER_AREA with the words typed in `areaOther`. */
export const OTHER_AREA = 'other';

const GENERAL_FIELDS = [...PERSON_FIELDS, 'area', 'areaOther'] as const;

/** What was typed on the general form, kept to show again after a refusal (never the CV). */
export function generalTypedValues(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of GENERAL_FIELDS) out[name] = text(fd, name);
  if (fd.get('consent')) out.consent = 'on';
  return out;
}

/** The general form as the rules check it. */
export function generalInputOf(fd: FormData): GeneralCvInput {
  const area = text(fd, 'area');
  return {
    fullName: text(fd, 'fullName'),
    email: text(fd, 'email'),
    mobile: text(fd, 'mobile'),
    linkedin: webLinkOf(text(fd, 'linkedin')) || null,
    portfolio: webLinkOf(text(fd, 'portfolio')) || null,
    yearsExperience: numberOf(text(fd, 'yearsExperience')),
    noticePeriod: noticeFrom(fd),
    expectedSalary: numberOf(text(fd, 'expectedSalary')),
    departmentId: area && area !== OTHER_AREA ? area : null,
    areaOther: area === OTHER_AREA ? text(fd, 'areaOther') || null : null,
    consent: fd.get('consent') !== null,
  };
}

/** What is wrong with the general form before it is sent, in words (the CV's checks are the API's). */
export function generalFormProblems(fd: FormData): string[] {
  const problems = generalCvProblems(generalInputOf(fd), { byHr: false });
  const cv = fd.get('cv');
  if (!(cv instanceof Blob) || cv.size === 0) problems.push('Attach your CV, as a PDF or a Word file.');
  return problems;
}

/** The general form as the API takes it (POST /public/general-cvs): the fields as text, where it came from, and the CV. */
export function generalApiForm(fd: FormData, from: { ip?: string; userAgent?: string }): FormData {
  const input = generalInputOf(fd);
  const out = personForm(fd);
  if (input.departmentId) out.set('departmentId', input.departmentId);
  if (input.areaOther) out.set('areaOther', input.areaOther);
  if (input.consent) out.set('consent', 'true');
  const honeypot = text(fd, HONEYPOT);
  if (honeypot) out.set(HONEYPOT, honeypot);
  if (from.ip) out.set('ip', from.ip);
  if (from.userAgent) out.set('userAgent', from.userAgent);
  const cv = fd.get('cv');
  if (cv instanceof Blob && cv.size > 0) out.set('cv', cv, cv instanceof File ? cv.name : 'cv');
  return out;
}
