import {
  applyProblems,
  checkPortfolio,
  emailProblem,
  generalCvProblems,
  HIDDEN_PORTFOLIO,
  LINKEDIN_TICKET_FIELD,
  mobileProblem,
  noticeOf,
  noticeProblem,
  OTHER_POSITION,
  PORTFOLIO_FILE_FIELD,
  PORTFOLIO_LIMITS,
  PORTFOLIO_LINKS_FIELD,
  portfolioLinkField,
  sourceOf,
  webLinkOf,
  yearsProblem,
  type ApplicationSource,
  type ApplyInput,
  type GeneralCvInput,
  type PortfolioAsk,
  type PublicGeneralForm,
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

/**
 * The tick "Send me updates about my application on WhatsApp" (owner, 24 October 2026: "how to make whatsapp
 * notifications?"; asked whom, "Employees and candidates": candidates who tick it on the careers form), off unless
 * ticked: sent to the API as whatsapp=true, with the page's language (these pages are English).
 */
export const WHATSAPP_FIELD = 'whatsapp';

/** Whether the WhatsApp tick is ticked. */
const whatsappTicked = (fd: FormData): boolean => fd.get(WHATSAPP_FIELD) !== null;

/** The WhatsApp tick as the API takes it: whatsapp=true and the page's language, only when ticked. */
function setWhatsApp(fd: FormData, out: FormData): void {
  if (!whatsappTicked(fd)) return;
  out.set(WHATSAPP_FIELD, 'true');
  out.set('whatsappLanguage', 'en');
}

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

/**
 * The person's fields, as the forms name them: the mobile as kept (PhoneInput's hidden field), the notice period's number
 * and unit (NoticeInput's). The one portfolio box of before became the portfolio's link boxes (owner, 25 October 2026:
 * "for creatives, they need to add their portfolios"; asked, "Portfolio per position": PORTFOLIO_BOXES), and LinkedIn's
 * ticket ("Fill in with LinkedIn") is kept with them.
 */
const PERSON_FIELDS = ['fullName', 'email', 'mobile', 'linkedin', 'yearsExperience', 'noticeNumber', 'noticeUnit', 'expectedSalary'] as const;

/** The fields sent to the API as typed (the notice period goes as one, noticeFrom; the portfolio as its links, portfolioOf). */
const SENT_FIELDS = ['fullName', 'email', 'mobile', 'linkedin', 'yearsExperience', 'expectedSalary'] as const;

/** The portfolio's link boxes on a form: portfolioLink-0 … portfolioLink-2 (at most 3 links, portfolio.ts). */
export const PORTFOLIO_BOXES = Array.from({ length: PORTFOLIO_LIMITS.links }, (_, i) => portfolioLinkField(i));

/** The portfolio links typed, in order, the empty boxes left out. */
export const portfolioLinksOf = (fd: FormData): string[] => PORTFOLIO_BOXES.map((name) => text(fd, name)).filter(Boolean);

/** The PDF case study attached, when one is (an empty file box sends an empty file). */
function portfolioFileOf(fd: FormData): Blob | null {
  const f = fd.get(PORTFOLIO_FILE_FIELD);
  return f instanceof Blob && f.size > 0 ? f : null;
}

const PORTFOLIO_FILE_BYTES = PORTFOLIO_LIMITS.fileMb * 1024 * 1024;

/**
 * What is wrong with the form's portfolio for what it asks (portfolio.ts checkPortfolio: the links' shapes, how many,
 * Required with none), and the PDF case study's: a PDF of 5 MB at most. Nothing when it isn't asked (hidden).
 */
export function portfolioProblems(fd: FormData, ask: PortfolioAsk = HIDDEN_PORTFOLIO): string[] {
  if (ask.mode === 'hidden') return [];
  const file = ask.kinds.includes('pdf') ? portfolioFileOf(fd) : null;
  const problems = [...checkPortfolio({ links: portfolioLinksOf(fd), file: !!file }, ask).problems];
  if (file) {
    const name = file instanceof File ? file.name : '';
    if (!(file.type === 'application/pdf' || /\.pdf$/i.test(name))) problems.push('Your portfolio file must be a PDF.');
    else if (file.size > PORTFOLIO_FILE_BYTES) problems.push(`Your portfolio PDF must be ${PORTFOLIO_LIMITS.fileMb} MB or smaller.`);
  }
  return problems;
}

/** The portfolio a position asks for on "Send us your CV": the position's, Other's, or none (hidden) before one is chosen. */
export function generalPortfolioAsk(position: string, form: Pick<PublicGeneralForm, 'portfolios' | 'otherPortfolio'> | null | undefined): PortfolioAsk {
  if (!position) return HIDDEN_PORTFOLIO;
  if (position === OTHER_POSITION) return form?.otherPortfolio ?? HIDDEN_PORTFOLIO;
  return form?.portfolios?.[position] ?? HIDDEN_PORTFOLIO;
}

/** The notice period as kept, "30 days" or "2 months", from the form's number and unit; null without a number. */
export const noticeFrom = (fd: FormData): string | null => noticeOf(text(fd, 'noticeNumber'), text(fd, 'noticeUnit'));

/** What was typed, kept to show again after a refusal (never the CV). */
export function typedValues(fd: FormData, questions: readonly PublicQuestion[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of PERSON_FIELDS) out[name] = text(fd, name);
  keepPortfolio(fd, out);
  for (const q of questions) out[answerField(q.key)] = text(fd, answerField(q.key));
  if (fd.get('consent')) out.consent = 'on';
  if (whatsappTicked(fd)) out[WHATSAPP_FIELD] = 'on';
  return out;
}

/** The portfolio's boxes and LinkedIn's ticket, kept to show again after a refusal (never the PDF). */
function keepPortfolio(fd: FormData, out: Record<string, string>): void {
  for (const name of PORTFOLIO_BOXES) {
    const v = text(fd, name);
    if (v) out[name] = v;
  }
  const ticket = text(fd, LINKEDIN_TICKET_FIELD);
  if (ticket) out[LINKEDIN_TICKET_FIELD] = ticket;
}

const numberOf = (t: string): number | null => (t === '' ? null : Number(t.replace(/,/g, '')));

/** The application as the rules check it: what the page can say before sending (the API says the rest). */
export function applyInputOf(fd: FormData, questions: readonly PublicQuestion[]): ApplyInput {
  return {
    fullName: text(fd, 'fullName'),
    email: text(fd, 'email'),
    mobile: text(fd, 'mobile'),
    linkedin: webLinkOf(text(fd, 'linkedin')) || null,
    // the portfolio's links are checked by what the position asks (portfolioProblems), not as one link
    portfolio: null,
    yearsExperience: numberOf(text(fd, 'yearsExperience')),
    noticePeriod: noticeFrom(fd),
    expectedSalary: numberOf(text(fd, 'expectedSalary')),
    answers: answersFrom(fd, questions),
    consent: fd.get('consent') !== null,
  };
}

/** The years of experience, asked on a job's form (the general form's are optional). */
export const YEARS_REQUIRED = 'Write your years of experience as a number, e.g. 3.';

/**
 * What is wrong with the form before it is sent, in words (the CV's checks are the API's); its portfolio by what the
 * vacancy asks (25 October 2026), none when it asks for none.
 */
export function applyFormProblems(fd: FormData, questions: readonly PublicQuestion[], portfolio: PortfolioAsk = HIDDEN_PORTFOLIO): string[] {
  const problems = applyProblems(applyInputOf(fd, questions), questions.map(asRules));
  if (!text(fd, 'yearsExperience')) problems.push(YEARS_REQUIRED);
  problems.push(...portfolioProblems(fd, portfolio));
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
  setWhatsApp(fd, out);
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
  // the portfolio (25 October 2026): its links as a list, the PDF case study; and LinkedIn's ticket, for the email's mark
  const links = portfolioLinksOf(fd);
  if (links.length) out.set(PORTFOLIO_LINKS_FIELD, JSON.stringify(links));
  const file = portfolioFileOf(fd);
  if (file) out.set(PORTFOLIO_FILE_FIELD, file, file instanceof File && file.name ? file.name : 'portfolio.pdf');
  const ticket = text(fd, LINKEDIN_TICKET_FIELD);
  if (ticket) out.set(LINKEDIN_TICKET_FIELD, ticket);
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

/**
 * The general form's position field (owner, 25 October 2026: "should it be the positions?"; asked, "Position, grouped by
 * team"): a position's key, or OTHER_POSITION ("Other (write it)") with the words typed in `positionOther`.
 */
export const POSITION_FIELD = 'position';

/**
 * The area field of before (a team's id, or OTHER_AREA with the words in `areaOther`): read for one release from a page
 * still open from before the positions, which sends `area` and no `position`; the API keeps it as its team, with no
 * position.
 */
export const OTHER_AREA = 'other';

const GENERAL_FIELDS = [...PERSON_FIELDS, POSITION_FIELD, 'positionOther', 'area', 'areaOther'] as const;

/** What was typed on the general form, kept to show again after a refusal (never the CV). */
export function generalTypedValues(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of GENERAL_FIELDS) out[name] = text(fd, name);
  keepPortfolio(fd, out);
  if (fd.get('consent')) out.consent = 'on';
  if (whatsappTicked(fd)) out[WHATSAPP_FIELD] = 'on';
  return out;
}

/**
 * The general form as the rules check it: the position chosen (its key) or Other in words; from a page of before the
 * positions (an `area` and no `position`), the area as before: a team's id, or Other in words.
 */
export function generalInputOf(fd: FormData): GeneralCvInput {
  const position = text(fd, POSITION_FIELD);
  const legacy = !position && fd.get(POSITION_FIELD) === null;
  const area = legacy ? text(fd, 'area') : '';
  return {
    fullName: text(fd, 'fullName'),
    email: text(fd, 'email'),
    mobile: text(fd, 'mobile'),
    linkedin: webLinkOf(text(fd, 'linkedin')) || null,
    // the portfolio's links are checked by what the position asks (portfolioProblems), not as one link
    portfolio: null,
    yearsExperience: numberOf(text(fd, 'yearsExperience')),
    noticePeriod: noticeFrom(fd),
    expectedSalary: numberOf(text(fd, 'expectedSalary')),
    positionKey: position && position !== OTHER_POSITION ? position : null,
    positionOther: position === OTHER_POSITION ? text(fd, 'positionOther') || null : null,
    departmentId: area && area !== OTHER_AREA ? area : null,
    areaOther: area === OTHER_AREA ? text(fd, 'areaOther') || null : null,
    consent: fd.get('consent') !== null,
  };
}

/**
 * What is wrong with the general form before it is sent, in words (the CV's checks are the API's); its portfolio by
 * what the chosen position asks (25 October 2026: `form`'s portfolios), none without them.
 */
export function generalFormProblems(fd: FormData, form?: Pick<PublicGeneralForm, 'portfolios' | 'otherPortfolio'> | null): string[] {
  const problems = generalCvProblems(generalInputOf(fd), { byHr: false });
  problems.push(...portfolioProblems(fd, generalPortfolioAsk(text(fd, POSITION_FIELD), form)));
  const cv = fd.get('cv');
  if (!(cv instanceof Blob) || cv.size === 0) problems.push('Attach your CV, as a PDF or a Word file.');
  return problems;
}

/** The general form as the API takes it (POST /public/general-cvs): the fields as text, where it came from, and the CV. */
export function generalApiForm(fd: FormData, from: { ip?: string; userAgent?: string }): FormData {
  const input = generalInputOf(fd);
  const out = personForm(fd);
  if (input.positionKey) out.set('positionKey', input.positionKey);
  if (input.positionOther) out.set('positionOther', input.positionOther);
  // a page of before the positions: its area as it sent it (one release)
  if (input.departmentId) out.set('departmentId', input.departmentId);
  if (input.areaOther) out.set('areaOther', input.areaOther);
  if (input.consent) out.set('consent', 'true');
  setWhatsApp(fd, out);
  const honeypot = text(fd, HONEYPOT);
  if (honeypot) out.set(HONEYPOT, honeypot);
  if (from.ip) out.set('ip', from.ip);
  if (from.userAgent) out.set('userAgent', from.userAgent);
  const cv = fd.get('cv');
  if (cv instanceof Blob && cv.size > 0) out.set('cv', cv, cv instanceof File ? cv.name : 'cv');
  return out;
}
