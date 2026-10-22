import { applyProblems, sourceOf, type ApplicationSource, type ApplyInput, type PublicQuestion, type VacancyQuestion } from '@trendlix/shared';

// The careers page (owner, 22 October 2026: "where will we include the ATS?"; people.trendlix.com/careers: "i dont know
// how to decide it for now"): reading its application form and passing it on to the API. Pure code (relative imports),
// tested in careers.test.ts; the API checks every rule again.

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

/** What was typed, kept to show again after a refusal (never the CV). */
export function typedValues(fd: FormData, questions: readonly PublicQuestion[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of ['fullName', 'email', 'mobile', 'linkedin', 'portfolio', 'yearsExperience', 'noticePeriod', 'expectedSalary']) out[name] = text(fd, name);
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
    linkedin: text(fd, 'linkedin') || null,
    portfolio: text(fd, 'portfolio') || null,
    yearsExperience: numberOf(text(fd, 'yearsExperience')),
    noticePeriod: text(fd, 'noticePeriod') || null,
    expectedSalary: numberOf(text(fd, 'expectedSalary')),
    answers: answersFrom(fd, questions),
    consent: fd.get('consent') !== null,
  };
}

/** What is wrong with the form before it is sent, in words (the CV's checks are the API's). */
export function applyFormProblems(fd: FormData, questions: readonly PublicQuestion[]): string[] {
  const problems = applyProblems(applyInputOf(fd, questions), questions.map(asRules));
  const cv = fd.get('cv');
  if (!(cv instanceof Blob) || cv.size === 0) problems.push('Attach your CV, as a PDF or a Word file.');
  return problems;
}

/**
 * The form as the API takes it (POST /public/careers/:slug/apply): the fields as text, the answers as JSON, the
 * channel it came by, where it came from, and the CV.
 */
export function apiForm(fd: FormData, questions: readonly PublicQuestion[], from: { source: string | null; ip?: string; userAgent?: string }): FormData {
  const out = new FormData();
  for (const name of ['fullName', 'email', 'mobile', 'linkedin', 'portfolio', 'yearsExperience', 'noticePeriod', 'expectedSalary']) {
    const v = text(fd, name);
    if (v) out.set(name, v);
  }
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

/** "Full-time · Hybrid (office and home) · Production", the job's facts in a line. */
export const factsLine = (parts: readonly (string | null | undefined)[]) => parts.filter((p): p is string => !!p).join(' · ');
