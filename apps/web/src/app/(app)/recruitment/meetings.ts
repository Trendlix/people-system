import {
  MEETING_KEEP,
  MEETING_PASTE,
  MEETING_PROVIDER_LABELS,
  parseMeetingChoice,
  providerOfLink,
  type InterviewSaved,
  type InterviewView,
  type MeetingChoices,
  type MeetingProvider,
} from '@trendlix/shared';
import { emailText } from './hiring';

// Online interviews' meetings on the site (owner, 24 October 2026: "can i link an online meeting service provider to
// automatically generate meeting links? line teams - gogole meet - zoom - etc.."; "Google Meet, Microsoft Teams, Zoom";
// "make it both"): the form's "Create the meeting with" choices, the words for what a save did to the meeting, the Join
// link an interview shows, and "Try again" / "Paste a link" when its meeting couldn't be made. Pure code (relative
// imports), tested in meetings.test.ts; the API checks everything again.

/** No choices: only "Paste a link" (nothing connected, or the API refused or isn't there yet). */
export const NO_MEETING_CHOICES: MeetingChoices = { choices: [], start: MEETING_PASTE };

/** "Create the meeting with": the value each option sends, and its words. */
export interface MeetingOption {
  value: string;
  label: string;
}

/**
 * The options and the one the form starts on: on a move of an interview with a meeting the system made, "Keep this
 * meeting" first (and started on); then the scheduler's choices (the company's default first, else their own); then
 * "Paste a link". A move of one with a pasted link starts on "Paste a link", as it was.
 */
export function meetingOptions(choices: MeetingChoices, interview?: Pick<InterviewView, 'kind' | 'meeting' | 'location'> | null): { options: MeetingOption[]; start: string } {
  const keep = interview?.meeting ? [{ value: MEETING_KEEP, label: `Keep this meeting (${MEETING_PROVIDER_LABELS[interview.meeting.provider]})` }] : [];
  const options = [...keep, ...choices.choices.map((c) => ({ value: c.key, label: c.label })), { value: MEETING_PASTE, label: 'Paste a link' }];
  const start = keep.length ? MEETING_KEEP : interview?.kind === 'online' && interview.location ? MEETING_PASTE : choices.start;
  return { options, start: options.some((o) => o.value === start) ? start : MEETING_PASTE };
}

/** Whether a choice brings its own link (made by the system, or kept): the link box is shown only for "Paste a link". */
export const makesMeeting = (value: string): boolean => value === MEETING_KEEP || parseMeetingChoice(value) !== null;

/** What the page says once an interview is saved, moved, cancelled or its meeting retried: the meeting, then the email. */
export function interviewSavedText(saved: Pick<InterviewSaved, 'email' | 'meeting' | 'meetingProblem'> & { interview?: Pick<InterviewView, 'meeting'> | null }): string {
  const name = saved.interview?.meeting ? MEETING_PROVIDER_LABELS[saved.interview.meeting.provider] : null;
  switch (saved.meeting) {
    case 'failed':
      return `Saved, but ${lowerFirst(saved.meetingProblem ?? 'the meeting couldn’t be made.')} Nobody was told yet: try again or paste a link on the interview.`;
    case 'created':
      return `The ${name ?? 'online'} meeting was created. ${emailText(saved.email)}`;
    case 'updated':
      return `The ${name ?? 'online'} meeting was moved too. ${emailText(saved.email)}`;
    case 'deleted':
      return saved.meetingProblem ? `${emailText(saved.email)} ${saved.meetingProblem}` : `The online meeting was deleted. ${emailText(saved.email)}`;
    default:
      return saved.meetingProblem ? `${emailText(saved.email)} ${saved.meetingProblem}` : emailText(saved.email);
  }
}

/** "Google refused: …" kept as it is (a name starts it); a sentence otherwise read on after "Saved, but". */
function lowerFirst(text: string): string {
  const t = text.trim();
  if (/^(Google|Microsoft|Zoom|The meeting|Your|My|Company)\b/.test(t)) return t;
  return t ? t[0].toLowerCase() + t.slice(1) : t;
}

/** An interview's Join: its link (the made meeting's, or the one pasted for an online one) and its service, if known. */
export function joinOf(i: Pick<InterviewView, 'kind' | 'location' | 'meeting'>): { url: string; provider: MeetingProvider | null } | null {
  const url = i.meeting?.joinUrl ?? (i.kind === 'online' ? i.location : null);
  if (!url || !/^https:\/\/[^\s]+$/i.test(url)) return null;
  return { url, provider: i.meeting?.provider ?? providerOfLink(url) };
}

/** The service an interview is held on, for the lists: "Google Meet", or null when not known (or not online). */
export const meetingNameOf = (i: Pick<InterviewView, 'kind' | 'location' | 'meeting'>): string | null => {
  if (i.meeting) return MEETING_PROVIDER_LABELS[i.meeting.provider];
  const p = i.kind === 'online' ? providerOfLink(i.location) : null;
  return p ? MEETING_PROVIDER_LABELS[p] : null;
};

/** POST /recruitment/interviews/:id/meeting's body: a choice to make it with, or a link pasted. */
export function meetingFixForm(fd: FormData): { body: { meeting: string } | { link: string } | null; errors: string[] } {
  const v = (name: string) => {
    const x = fd.get(name);
    return typeof x === 'string' ? x.trim() : '';
  };
  const link = v('link');
  if (fd.has('link')) {
    if (!/^https:\/\/[^\s/]+\.[^\s]+$/i.test(link)) return { body: null, errors: ['Give the meeting’s link in full, starting with https://.'] };
    return { body: { link }, errors: [] };
  }
  const meeting = v('meeting');
  if (!parseMeetingChoice(meeting)) return { body: null, errors: ['Choose what creates the meeting.'] };
  return { body: { meeting }, errors: [] };
}
