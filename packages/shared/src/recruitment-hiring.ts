// Recruitment, the ATS, Phase 2 (owner, 22 October 2026: "where will we include the ATS?"; accepted: "interview invites go
// by email through the owner's SMTP settings"; the original plan's spec §12). What Phase 1 (recruitment.ts) left for it:
// - The pipeline board: a vacancy's applicants in a column per stage, moved by dragging (or a keyboard's "Move to"), with
//   the stage actions' rules: Reject asks why, Offer goes through Make offer, Hired only by an accepted job offer.
// - Interviews: scheduled from an applicant (a day and time in Cairo, a length, in person, online or by phone, the
//   interviewers, a note to the candidate); the candidate invited by email with a calendar invitation (.ics) and the
//   interviewers told; rescheduled and cancelled the same way; marked done or no-show.
// - The hiring manager and the interviewers: the hiring manager sees their vacancy's applicants from Shortlisted on, the
//   interviewers those they interview; never the salary range nor the candidate's expected salary. Each interviewer
//   gives a scorecard after the interview; an interviewer sees the others' only once they gave theirs (no anchoring).
//   The hiring manager may suggest the next step or a rejection, which HR acts on.
// - The rejection email, an "Email the candidate" tick on Reject (off by default), with HR's words or the standard ones.
// - Recruitment analytics: open positions, active candidates, hires, time to hire and to fill, offer acceptance,
//   probation pass rate, the funnel, hires by month, sources and time to hire by department.
// Pure code: the API enforces these rules, the web shows them. Tested in apps/api/src/common/recruitment-hiring.spec.ts.

import { APPLICATION_STAGE_LABELS, offerable, stageMoveProblem, type ApplicationSource, type ApplicationStage, type HandStage, type RecruitmentUserRef } from './recruitment.js';
import type { GeneralCvSource } from './general-cvs.js';

// ---------- who looks ----------

/**
 * How the caller sees recruitment: HR (and a Super Admin) manage it, the CEO reads everything, a vacancy's hiring manager
 * sees its applicants from Shortlisted on, an interviewer those they interview.
 */
export const RECRUITMENT_VIEWERS = ['manages', 'reads', 'hiring_manager', 'interviewer'] as const;
export type RecruitmentViewer = (typeof RECRUITMENT_VIEWERS)[number];

/** The stages a hiring manager sees their vacancy's applicants at (owner's brief: "from Shortlisted on"). */
export const HIRING_MANAGER_STAGES = ['shortlisted', 'interview', 'offer', 'hired'] as const satisfies readonly ApplicationStage[];

/** Whether a hiring manager sees an applicant: from Shortlisted on, or rejected from there; never one filtered out. */
export function hiringManagerSees(a: { stage: ApplicationStage; rejectedFrom: string | null; filteredOut: boolean }): boolean {
  if (a.filteredOut) return false;
  if ((HIRING_MANAGER_STAGES as readonly string[]).includes(a.stage)) return true;
  return a.stage === 'rejected' && (HIRING_MANAGER_STAGES as readonly string[]).includes(a.rejectedFrom ?? '');
}

// ---------- the pipeline board ----------

/** The board's columns, in order: every stage. A hiring manager's board starts at Shortlisted. */
export const BOARD_STAGES = ['applied', 'shortlisted', 'interview', 'offer', 'hired', 'rejected'] as const satisfies readonly ApplicationStage[];

/** What dropping a card on a column does: a move (Reject asks why first), Make offer, or nothing, with why. */
export type BoardMove = { kind: 'move'; to: HandStage; needsReason: boolean } | { kind: 'offer' } | { kind: 'refused'; reason: string };

/**
 * What moving an applicant from `from` to the column `to` does on the board (the brief: "the same rules as the stage
 * actions: Reject asks for a reason; Offer goes through Make offer; Hired only by an accepted offer").
 */
export function boardMove(from: ApplicationStage, to: ApplicationStage, state: { filteredOut: boolean; openOffer: boolean }): BoardMove {
  if (from === to) return { kind: 'refused', reason: `They are at ${APPLICATION_STAGE_LABELS[to]} already.` };
  if (to === 'applied') return { kind: 'refused', reason: 'Nobody goes back to Applied: shortlist them, or reject them.' };
  if (to === 'hired') return { kind: 'refused', reason: 'Hired follows an accepted job offer: make them an offer first.' };
  if (to === 'offer') {
    if (state.openOffer) return { kind: 'refused', reason: 'A job offer to them is open already: open it from their page.' };
    if (!offerable({ stage: from, filteredOut: state.filteredOut })) {
      return {
        kind: 'refused',
        reason: state.filteredOut ? 'They failed a must-have question and were filtered out: restore them first.' : `They are at ${APPLICATION_STAGE_LABELS[from]}: shortlist them first.`,
      };
    }
    return { kind: 'offer' };
  }
  const problem = stageMoveProblem(from, to, state);
  if (problem) return { kind: 'refused', reason: problem };
  return { kind: 'move', to, needsReason: to === 'rejected' };
}

/** When an applicant reached their stage: the moment of the last step that changed it (`steps` oldest first). */
export function stageSince(steps: readonly { stage: string; at: string | Date }[], fallback: string | Date): string {
  let since: string | Date = fallback;
  let last: string | null = null;
  for (const s of steps) {
    if (s.stage !== last) since = s.at;
    last = s.stage;
  }
  return new Date(since).toISOString();
}

/** Whole days from `since` to `now` (never below 0). */
export const daysSince = (since: string | Date, now: Date | number = Date.now()): number =>
  Math.max(0, Math.floor((new Date(now).getTime() - new Date(since).getTime()) / 86_400_000));

// ---------- interviews ----------

export const INTERVIEW_KINDS = ['in_person', 'online', 'phone'] as const;
export type InterviewKind = (typeof INTERVIEW_KINDS)[number];

export const INTERVIEW_KIND_LABELS: Record<InterviewKind, string> = { in_person: 'In person', online: 'Online', phone: 'By phone' };

export const isInterviewKind = (value: unknown): value is InterviewKind => (INTERVIEW_KINDS as readonly unknown[]).includes(value);

export const INTERVIEW_STATUSES = ['scheduled', 'done', 'no_show', 'cancelled'] as const;
export type InterviewStatus = (typeof INTERVIEW_STATUSES)[number];

export const INTERVIEW_STATUS_LABELS: Record<InterviewStatus, string> = { scheduled: 'Scheduled', done: 'Done', no_show: 'No-show', cancelled: 'Cancelled' };

export const INTERVIEW_LIMITS = {
  minutesMin: 15,
  minutesMax: 480,
  location: 300,
  note: 1000,
  interviewers: 6,
  reason: 500,
  /** How far ahead an interview may be. */
  daysAhead: 365,
} as const;

/** The lengths the form offers, in minutes. */
export const INTERVIEW_LENGTHS = [15, 30, 45, 60, 90, 120] as const;

/** What scheduling (or rescheduling) an interview sends: the day and time in Cairo, its length, how, where, who, a note. */
export interface InterviewInput {
  /** YYYY-MM-DD, in Cairo. */
  date: string;
  /** HH:mm (24 hours), in Cairo. */
  time: string;
  minutes: number;
  kind: InterviewKind;
  /** In person: the address (the office's when left out); online: the meeting's link; by phone: the number to call from or a note. */
  location?: string | null;
  /** The interviewers: current employees' ids, 1 to 6. */
  interviewerIds: string[];
  /** A few words to the candidate, in the invitation. */
  note?: string | null;
}

const isLink = (v: string) => /^https:\/\/[^\s/]+\.[^\s]+$/i.test(v);

/**
 * What is wrong with an interview's details, each in words: a day and a time (from `now` on, at most a year ahead), a
 * length from 15 minutes to 8 hours in quarter hours, how it is held (an online one with its https link), at most 300
 * characters of place, 1 to 6 different interviewers, the note at most 1000 characters. `startsAt`: the moment the day
 * and time are in Cairo (worked out by the caller with zonedMoment), NaN when they aren't one.
 */
export function interviewProblems(input: Partial<InterviewInput>, startsAt: number, now: number): string[] {
  const L = INTERVIEW_LIMITS;
  const problems: string[] = [];
  if (typeof input.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.date) || typeof input.time !== 'string' || !/^\d{2}:\d{2}$/.test(input.time) || !Number.isFinite(startsAt)) {
    problems.push('Choose the day and the time of the interview.');
  } else if (startsAt < now) {
    problems.push('That time has passed: choose a later one.');
  } else if (startsAt > now + L.daysAhead * 86_400_000) {
    problems.push('Choose a day within a year.');
  }
  const m = input.minutes;
  if (!(typeof m === 'number' && Number.isInteger(m) && m >= L.minutesMin && m <= L.minutesMax && m % 15 === 0)) problems.push('Give its length in quarter hours, from 15 minutes to 8 hours.');
  if (!isInterviewKind(input.kind)) problems.push('Choose how it is held: in person, online or by phone.');
  const location = typeof input.location === 'string' ? input.location.trim() : '';
  if (location.length > L.location) problems.push(`Keep the place to ${L.location} characters or fewer.`);
  if (input.kind === 'online' && !isLink(location)) problems.push('Give the meeting’s link in full, starting with https://.');
  const ids = Array.isArray(input.interviewerIds) ? input.interviewerIds : [];
  if (!ids.length) problems.push('Choose who interviews them.');
  else if (ids.length > L.interviewers) problems.push(`Choose at most ${L.interviewers} interviewers.`);
  else if (new Set(ids).size !== ids.length) problems.push('An interviewer is chosen twice.');
  const note = typeof input.note === 'string' ? input.note.trim() : '';
  if (note.length > L.note) problems.push(`Keep the note to ${L.note} characters or fewer.`);
  return problems;
}

/** Whether feedback can be given on an interview at `now`: not cancelled nor a no-show, and it has started. */
export const feedbackOpen = (i: { status: InterviewStatus; startsAt: string | Date }, now: number): boolean =>
  (i.status === 'scheduled' || i.status === 'done') && new Date(i.startsAt).getTime() <= now;

/** Whether an interview can still be rescheduled or cancelled: only while scheduled. */
export const interviewChangeable = (status: InterviewStatus): boolean => status === 'scheduled';

// ---------- the calendar invitation ----------

/** A person on a calendar invitation. */
export interface IcsPerson {
  name: string;
  email: string;
}

/** What an invitation (.ics, iCalendar) is made of. */
export interface IcsEvent {
  /** Stable for the interview, so a calendar updates or removes the same event. */
  uid: string;
  /** 0 when first sent, one more each time it changes (RFC 5545). */
  sequence: number;
  method: 'REQUEST' | 'CANCEL';
  start: Date;
  minutes: number;
  summary: string;
  description: string;
  location: string;
  organizer: IcsPerson;
  attendees: IcsPerson[];
  /** When it was made (DTSTAMP). */
  stamp: Date;
}

/** A moment as iCalendar writes one in UTC: 20261105T073000Z. */
export const icsMoment = (d: Date): string => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** A text value escaped as iCalendar needs it: backslashes, semicolons, commas and new lines. */
export const icsText = (value: string): string => value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');

/** A parameter's value (a name): quoted, without quotes or control characters of its own. */
const icsParam = (value: string): string => `"${value.replace(/["\r\n\t]/g, ' ').trim()}"`;

/** An address on a mailto: line, without anything that would break the line. */
const icsMail = (email: string): string => email.replace(/[\s;,:"<>]/g, '');

/** A line folded at 75 octets (RFC 5545 §3.1), its UTF-8 characters never split. */
export function icsFold(line: string): string {
  const out: string[] = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const bytes = new TextEncoder().encode(ch).length;
    const limit = out.length ? 74 : 75; // a continued line starts with a space
    if (size + bytes > limit) {
      out.push(current);
      current = '';
      size = 0;
    }
    current += ch;
    size += bytes;
  }
  out.push(current);
  return out.join('\r\n ');
}

/** The invitation as an .ics file's text: one event, its lines folded, ended with CRLF. */
export function buildIcs(e: IcsEvent): string {
  const end = new Date(e.start.getTime() + e.minutes * 60_000);
  const lines = [
    'BEGIN:VCALENDAR',
    'PRODID:-//TrendLIX//People System//EN',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    `METHOD:${e.method}`,
    'BEGIN:VEVENT',
    `UID:${e.uid}`,
    `DTSTAMP:${icsMoment(e.stamp)}`,
    `DTSTART:${icsMoment(e.start)}`,
    `DTEND:${icsMoment(end)}`,
    `SEQUENCE:${e.sequence}`,
    `SUMMARY:${icsText(e.summary)}`,
    `DESCRIPTION:${icsText(e.description)}`,
    `LOCATION:${icsText(e.location)}`,
    `ORGANIZER;CN=${icsParam(e.organizer.name)}:mailto:${icsMail(e.organizer.email)}`,
    ...e.attendees.map((a) => `ATTENDEE;CN=${icsParam(a.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${icsMail(a.email)}`),
    `STATUS:${e.method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(icsFold).join('\r\n')}\r\n`;
}

// ---------- the invitation's words ----------

/** What the candidate's email about an interview says it with. */
export interface InterviewMailFacts {
  candidate: string;
  job: string;
  company: string;
  /** "Thursday 5 November 2026" and "10:30 AM", in Cairo; the day in Arabic too ("الخميس 5 نوفمبر 2026"), else the English. */
  day: string;
  dayAr?: string | null;
  time: string;
  minutes: number;
  kind: InterviewKind;
  location: string | null;
  /** Their mobile, for one by phone. */
  mobile: string | null;
  note: string | null;
}

export type InterviewMailKind = 'invite' | 'moved' | 'cancelled';

function howEn(f: InterviewMailFacts): string {
  if (f.kind === 'online') return `Online: ${f.location ?? ''}`.trim();
  if (f.kind === 'phone') return f.location ? `By phone: ${f.location}` : `By phone: we will call you${f.mobile ? ` on ${f.mobile}` : ''}`;
  return `In person: ${f.location ?? f.company}`;
}

function howAr(f: InterviewMailFacts): string {
  if (f.kind === 'online') return `عبر الإنترنت: ${f.location ?? ''}`.trim();
  if (f.kind === 'phone') return f.location ? `عبر الهاتف: ${f.location}` : `عبر الهاتف: سنتصل بك${f.mobile ? ` على ${f.mobile}` : ''}`;
  return `حضوريًا: ${f.location ?? f.company}`;
}

/**
 * The candidate's email about an interview, in English then Arabic (the brief: "bilingual-friendly"): invited, moved to
 * another time, or cancelled. The calendar invitation goes with it.
 */
export function interviewMail(kind: InterviewMailKind, f: InterviewMailFacts): { subject: string; text: string } {
  const when = `${f.day}, ${f.time} (Cairo time), ${f.minutes} minutes`;
  const dayAr = f.dayAr || f.day;
  const whenAr = `${dayAr}، الساعة ${f.time} بتوقيت القاهرة، لمدة ${f.minutes} دقيقة`;
  const note = f.note ? `\n${f.note}\n` : '';
  if (kind === 'cancelled') {
    return {
      subject: `Interview cancelled: ${f.job} · إلغاء المقابلة`,
      text: [
        `Dear ${f.candidate},`,
        '',
        `We are sorry: the interview for ${f.job} on ${f.day} at ${f.time} is cancelled. We will be in touch about what comes next.`,
        note,
        `Best regards,\n${f.company} HR`,
        '',
        '— — —',
        '',
        `عزيزي/عزيزتي ${f.candidate}،`,
        '',
        `نأسف لإبلاغك بإلغاء مقابلة وظيفة ${f.job} المحددة يوم ${f.dayAr || f.day} الساعة ${f.time}. سنتواصل معك بشأن الخطوات التالية.`,
        '',
        `مع التحية،\nالموارد البشرية – ${f.company}`,
      ].join('\n'),
    };
  }
  const moved = kind === 'moved';
  return {
    subject: moved ? `Interview moved: ${f.job} at ${f.company} · تغيير موعد المقابلة` : `Interview invitation: ${f.job} at ${f.company} · دعوة لمقابلة`,
    text: [
      `Dear ${f.candidate},`,
      '',
      moved
        ? `The interview for ${f.job} has moved to a new time:`
        : `Thank you for applying for ${f.job} at ${f.company}. We would like to invite you to an interview:`,
      '',
      `When: ${when}`,
      howEn(f),
      note,
      'The calendar invitation is attached. If the time doesn’t suit you, reply to this email.',
      '',
      `Best regards,\n${f.company} HR`,
      '',
      '— — —',
      '',
      `عزيزي/عزيزتي ${f.candidate}،`,
      '',
      moved ? `تم تغيير موعد مقابلة وظيفة ${f.job} إلى:` : `شكرًا لتقديمك على وظيفة ${f.job} في ${f.company}. يسعدنا دعوتك لمقابلة:`,
      '',
      `الموعد: ${whenAr}`,
      howAr(f),
      '',
      'دعوة التقويم مرفقة. إذا لم يناسبك الموعد، يُرجى الرد على هذه الرسالة.',
      '',
      `مع التحية،\nالموارد البشرية – ${f.company}`,
    ].join('\n'),
  };
}

// ---------- feedback ----------

/** What each interviewer rates, from 1 to 5 (the brief: "skills for the role, experience, communication, culture fit"). */
export const FEEDBACK_CRITERIA = ['skills', 'experience', 'communication', 'culture'] as const;
export type FeedbackCriterion = (typeof FEEDBACK_CRITERIA)[number];

export const FEEDBACK_CRITERION_LABELS: Record<FeedbackCriterion, string> = {
  skills: 'Skills for the role',
  experience: 'Experience',
  communication: 'Communication',
  culture: 'Culture fit',
};

export const RECOMMENDATIONS = ['strong_yes', 'yes', 'no', 'strong_no'] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];

export const RECOMMENDATION_LABELS: Record<Recommendation, string> = { strong_yes: 'Strong yes', yes: 'Yes', no: 'No', strong_no: 'Strong no' };

export const isRecommendation = (value: unknown): value is Recommendation => (RECOMMENDATIONS as readonly unknown[]).includes(value);

export const FEEDBACK_NOTES_MAX = 2000;

/** An interviewer's scorecard. */
export interface FeedbackInput {
  ratings: Record<FeedbackCriterion, number>;
  recommendation: Recommendation;
  notes?: string | null;
}

/** What is wrong with a scorecard, each in words: each criterion rated 1 to 5, a recommendation, notes at most 2000. */
export function feedbackProblems(input: Partial<FeedbackInput>): string[] {
  const problems: string[] = [];
  const ratings = (input.ratings ?? {}) as Partial<Record<FeedbackCriterion, unknown>>;
  for (const c of FEEDBACK_CRITERIA) {
    const r = ratings[c];
    if (!(typeof r === 'number' && Number.isInteger(r) && r >= 1 && r <= 5)) problems.push(`Rate ${FEEDBACK_CRITERION_LABELS[c].toLowerCase()} from 1 to 5.`);
  }
  if (!isRecommendation(input.recommendation)) problems.push('Choose your recommendation: strong yes, yes, no or strong no.');
  if (typeof input.notes === 'string' && input.notes.trim().length > FEEDBACK_NOTES_MAX) problems.push(`Keep the notes to ${FEEDBACK_NOTES_MAX} characters or fewer.`);
  return problems;
}

/**
 * Whose scorecards the caller sees on an applicant (the brief: "HR, the CEO and the hiring manager see all of it.
 * Interviewers see their own until they submit, then everyone's on that applicant (avoid anchoring)").
 */
export function feedbackSeen(viewer: RecruitmentViewer, gaveOwn: boolean): 'all' | 'own' {
  if (viewer !== 'interviewer') return 'all';
  return gaveOwn ? 'all' : 'own';
}

// ---------- the hiring manager's suggestion ----------

/** What a hiring manager suggests HR do with an applicant. */
export const HIRING_SUGGESTIONS = ['next', 'reject'] as const;
export type HiringSuggestion = (typeof HIRING_SUGGESTIONS)[number];

export const HIRING_SUGGESTION_LABELS: Record<HiringSuggestion, string> = { next: 'Next step', reject: 'Reject' };

export const isHiringSuggestion = (value: unknown): value is HiringSuggestion => (HIRING_SUGGESTIONS as readonly unknown[]).includes(value);

export const SUGGESTION_NOTE_MAX = 500;

// ---------- the rejection email ----------

/** The rejection email's words as HR set them in Recruitment Settings; null: the standard. */
export interface RejectionWords {
  subject: string | null;
  en: string | null;
  ar: string | null;
}

/** The standard words: polite, short, with {name}, {job} and {company} filled in. */
export const REJECTION_STANDARD = {
  subject: 'Your application for {job} · طلبك لوظيفة {job}',
  en: [
    'Dear {name},',
    '',
    'Thank you for your interest in the {job} role at {company}, and for the time you gave to your application. After careful review, we have decided not to move forward with your application at this time.',
    '',
    'We will keep your details on file and may contact you about future openings that suit your experience.',
    '',
    'We wish you every success,',
    '{company} HR',
  ].join('\n'),
  ar: [
    'عزيزي/عزيزتي {name}،',
    '',
    'نشكرك على اهتمامك بوظيفة {job} في {company} وعلى الوقت الذي خصصته لطلبك. بعد مراجعة دقيقة، قررنا عدم المضي قدمًا في طلبك في الوقت الحالي.',
    '',
    'سنحتفظ ببياناتك وقد نتواصل معك بشأن فرص مستقبلية تناسب خبرتك.',
    '',
    'نتمنى لك كل التوفيق،',
    'الموارد البشرية – {company}',
  ].join('\n'),
} as const;

export const REJECTION_LIMITS = { subject: 150, text: 3000 } as const;

/** What is wrong with HR's words, each in words (empty: the standard). */
export function rejectionWordsProblems(w: Partial<RejectionWords>): string[] {
  const problems: string[] = [];
  const len = (v: unknown) => (typeof v === 'string' ? v.trim().length : 0);
  if (len(w.subject) > REJECTION_LIMITS.subject) problems.push(`Keep the subject to ${REJECTION_LIMITS.subject} characters or fewer.`);
  if (len(w.en) > REJECTION_LIMITS.text) problems.push(`Keep the English text to ${REJECTION_LIMITS.text} characters or fewer.`);
  if (len(w.ar) > REJECTION_LIMITS.text) problems.push(`Keep the Arabic text to ${REJECTION_LIMITS.text} characters or fewer.`);
  return problems;
}

const fill = (text: string, vars: { name: string; job: string; company: string }) =>
  text.replace(/\{name\}/g, vars.name).replace(/\{job\}/g, vars.job).replace(/\{company\}/g, vars.company);

/** The rejection email with HR's words (or the standard ones), English then Arabic. */
export function rejectionMail(words: RejectionWords, vars: { name: string; job: string; company: string }): { subject: string; text: string } {
  const subject = fill(words.subject?.trim() || REJECTION_STANDARD.subject, vars);
  const en = fill(words.en?.trim() || REJECTION_STANDARD.en, vars);
  const ar = fill(words.ar?.trim() || REJECTION_STANDARD.ar, vars);
  return { subject, text: `${en}\n\n— — —\n\n${ar}` };
}

// ---------- analytics ----------

/** The stages in the order an applicant goes through them (Rejected apart). */
export const FUNNEL_STAGES = ['applied', 'shortlisted', 'interview', 'offer', 'hired'] as const satisfies readonly ApplicationStage[];
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

const RANK: Record<string, number> = { applied: 0, shortlisted: 1, interview: 2, offer: 3, hired: 4 };

/** The furthest stage an application reached, from its history's stages (Rejected never counts as one). */
export function furthestStage(stages: readonly string[]): FunnelStage {
  let best = 0;
  for (const s of stages) if (s in RANK && RANK[s] > best) best = RANK[s];
  return FUNNEL_STAGES[best];
}

/** A % rounded to one decimal; null with nothing to divide by. */
export const percentOf = (n: number, of: number): number | null => (of > 0 ? Math.round((n / of) * 1000) / 10 : null);

/** The funnel: how many reached each stage (or went further), and the % of the stage before. */
export function funnelOf(furthest: readonly FunnelStage[]): { stage: FunnelStage; reached: number; conversion: number | null }[] {
  const reached = FUNNEL_STAGES.map((_, i) => furthest.filter((f) => RANK[f] >= i).length);
  return FUNNEL_STAGES.map((stage, i) => ({ stage, reached: reached[i], conversion: i === 0 ? null : percentOf(reached[i], reached[i - 1]) }));
}

/** The average of whole days between pairs of moments, to one decimal; null with none. */
export function averageDays(pairs: readonly (readonly [string | Date, string | Date])[]): number | null {
  if (!pairs.length) return null;
  const total = pairs.reduce((sum, [a, b]) => sum + (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000, 0);
  return Math.round((total / pairs.length) * 10) / 10;
}

/** GET /recruitment/analytics: the year's recruitment (the brief's spec §12 Analytics). */
export interface RecruitmentAnalytics {
  year: number;
  departmentId: string | null;
  /** Now: the open (or on hold) vacancies, and the people still to hire on them (headcount less hires). */
  openVacancies: number;
  openPositions: number;
  /** Now: applicants still in the running (Applied to Offer, not filtered out) on open vacancies. */
  activeCandidates: number;
  /** Applied in the year. */
  applicants: number;
  /** Hired in the year (an accepted job offer). */
  hires: number;
  /** Average days from applying to the accepted offer, for the year's hires. */
  timeToHireDays: number | null;
  /** Average days from the vacancy's publishing to the accepted offer, for the year's hires. */
  timeToFillDays: number | null;
  /** Job offers made from applications in the year: accepted of those answered. */
  offers: { made: number; accepted: number; declined: number; acceptanceRate: number | null };
  /** Hires whose probation has ended: those still employed after it. */
  probation: { ended: number; passed: number; rate: number | null };
  funnel: { stage: FunnelStage; reached: number; conversion: number | null }[];
  /** YYYY-MM, January to December. */
  hiresByMonth: { month: string; hires: number }[];
  sources: { source: ApplicationSource; applicants: number; shortlisted: number; hired: number }[];
  departments: { id: string | null; name: string; hires: number; timeToHireDays: number | null }[];
  /** C-level vacancies left out for the caller. */
  hidden: number;
  /**
   * General CVs received in the year (22 October 2026: general-cvs.ts), by source and by month, and how many of them were
   * moved to a vacancy. Not by department (they aren't a vacancy's).
   */
  generalCvs: { received: number; moved: number; bySource: { source: GeneralCvSource; count: number }[]; byMonth: { month: string; count: number }[] };
}

// ---------- the API's answers ----------

/** An interviewer on an interview, and whether they gave their scorecard. */
export interface InterviewerView {
  employeeId: string;
  name: string;
  feedbackGiven: boolean;
}

/** An interview, on an applicant's page and on the lists. */
export interface InterviewView {
  id: string;
  /** ISO. */
  startsAt: string;
  minutes: number;
  kind: InterviewKind;
  location: string | null;
  note: string | null;
  status: InterviewStatus;
  interviewers: InterviewerView[];
  /** The candidate's latest email about it (ISO), or null: not sent (email not set up, or it failed: `emailProblem`). */
  emailedAt: string | null;
  emailProblem: string | null;
  cancelReason: string | null;
  createdBy: RecruitmentUserRef | null;
  application: { id: string; number: string; fullName: string; vacancy: { id: string; number: string; title: string } };
  can: { reschedule: boolean; cancel: boolean; mark: boolean; feedback: boolean };
}

/** An interviewer's scorecard, as those who may see it see it. */
export interface FeedbackView {
  id: string;
  interviewId: string;
  interviewer: { employeeId: string; name: string };
  ratings: Record<FeedbackCriterion, number>;
  recommendation: Recommendation;
  notes: string | null;
  submittedAt: string;
  updatedAt: string;
  /** The caller's own. */
  mine: boolean;
}

/** The hiring manager's suggestion on an applicant, for HR to act on. */
export interface SuggestionView {
  kind: HiringSuggestion;
  note: string | null;
  by: RecruitmentUserRef | null;
  at: string;
}

/** What scheduling an interview answered: the interview, and whether the candidate was emailed. */
export interface InterviewSaved {
  interview: InterviewView;
  /** sent, not_set_up (email isn't set up on the server), failed (the provider refused), not_sent (nothing to tell). */
  email: 'sent' | 'not_set_up' | 'failed' | 'not_sent';
}

/** A card on the pipeline board. */
export interface BoardCard {
  id: string;
  number: string;
  fullName: string;
  matchPercent: number | null;
  source: ApplicationSource;
  stage: ApplicationStage;
  filteredOut: boolean;
  /** Whole days at their stage. */
  daysInStage: number;
  openOffer: boolean;
  /** Interviews still to come. */
  upcomingInterviews: number;
  suggestion: HiringSuggestion | null;
}

/** GET /recruitment/vacancies/:id/board. */
export interface VacancyBoard {
  vacancy: { id: string; number: string; title: string; status: string };
  viewer: RecruitmentViewer;
  /** The caller moves cards (HR, a Super Admin). */
  canMove: boolean;
  columns: { stage: ApplicationStage; cards: BoardCard[] }[];
  /** Applicants filtered out by a must-have, kept off the board. */
  filteredOut: number;
}

/** GET /recruitment/my-hiring: what the caller hires for or interviews. */
export interface MyHiring {
  vacancies: { id: string; number: string; title: string; status: string; counts: Record<ApplicationStage, number> }[];
  interviews: InterviewView[];
  /** Interviews of theirs past, without their scorecard yet. */
  feedbackDue: number;
}

/** GET /recruitment/settings. */
export interface RecruitmentSettingsView {
  rejection: RejectionWords;
  standard: { subject: string; en: string; ar: string };
  updatedAt: string | null;
  updatedBy: RecruitmentUserRef | null;
}
