import { describe, expect, it } from 'vitest';
import type { MeetingChoices } from '@trendlix/shared';
import { interviewForm } from './hiring';
import { interviewSavedText, joinOf, makesMeeting, meetingFixForm, meetingNameOf, meetingOptions, NO_MEETING_CHOICES } from './meetings';

// Online interviews' meetings (owner, 24 October 2026: "can i link an online meeting service provider to automatically
// generate meeting links?"; "Google Meet, Microsoft Teams, Zoom"; "make it both").

const form = (entries: [string, string][]) => {
  const fd = new FormData();
  for (const [k, v] of entries) fd.append(k, v);
  return fd;
};

const CHOICES: MeetingChoices = {
  choices: [
    { key: 'company:google', owner: 'company', provider: 'google', label: 'Company Google Meet' },
    { key: 'personal:zoom', owner: 'personal', provider: 'zoom', label: 'My Zoom' },
  ],
  start: 'company:google',
};

describe('Create the meeting with', () => {
  it('lists the choices, then Paste a link, starting on the company’s default (else their own)', () => {
    const { options, start } = meetingOptions(CHOICES);
    expect(options.map((o) => o.value)).toEqual(['company:google', 'personal:zoom', 'link']);
    expect(start).toBe('company:google');
    expect(meetingOptions(NO_MEETING_CHOICES)).toEqual({ options: [{ value: 'link', label: 'Paste a link' }], start: 'link' });
  });

  it('on a move, keeps the meeting it has first; one with a pasted link stays on Paste a link', () => {
    const made = meetingOptions(CHOICES, { kind: 'online', location: 'https://meet.google.com/abc-defg-hij', meeting: { provider: 'google', owner: 'company', joinUrl: 'https://meet.google.com/abc-defg-hij' } });
    expect(made.options[0]).toEqual({ value: 'keep', label: 'Keep this meeting (Google Meet)' });
    expect(made.start).toBe('keep');
    expect(meetingOptions(CHOICES, { kind: 'online', location: 'https://zoom.us/j/1', meeting: null }).start).toBe('link');
    expect(meetingOptions(CHOICES, { kind: 'in_person', location: 'Office', meeting: null }).start).toBe('company:google');
  });

  it('shows the link box only for Paste a link', () => {
    expect(makesMeeting('company:google')).toBe(true);
    expect(makesMeeting('keep')).toBe(true);
    expect(makesMeeting('link')).toBe(false);
    expect(makesMeeting('company:webex')).toBe(false);
  });

  it('sends the choice for an online interview, without a link when the system makes it', () => {
    const base: [string, string][] = [
      ['date', '05/11/2026'],
      ['time', '2:30 PM'],
      ['minutes', '45'],
      ['interviewerIds', 'a'],
    ];
    expect(interviewForm(form([...base, ['kind', 'online'], ['meeting', 'personal:zoom'], ['location', 'https://old.example/x']])).body).toMatchObject({ kind: 'online', meeting: 'personal:zoom', location: null });
    expect(interviewForm(form([...base, ['kind', 'online'], ['meeting', 'link'], ['location', 'https://meet.example.com/a']])).body).toMatchObject({ meeting: 'link', location: 'https://meet.example.com/a' });
    // not online: no meeting sent
    expect(interviewForm(form([...base, ['kind', 'in_person'], ['meeting', 'company:google']])).body).not.toHaveProperty('meeting');
  });
});

describe('what a save did', () => {
  const interview = { meeting: { provider: 'zoom' as const, owner: 'personal' as const, joinUrl: 'https://zoom.us/j/1' } };

  it('says the meeting, then the email', () => {
    expect(interviewSavedText({ email: 'sent', meeting: 'created', meetingProblem: null, interview })).toBe('The Zoom meeting was created. The candidate was emailed, with the calendar invitation.');
    expect(interviewSavedText({ email: 'sent', meeting: 'updated', meetingProblem: null, interview })).toBe('The Zoom meeting was moved too. The candidate was emailed, with the calendar invitation.');
    expect(interviewSavedText({ email: 'sent', meeting: 'deleted', meetingProblem: null })).toBe('The online meeting was deleted. The candidate was emailed, with the calendar invitation.');
    expect(interviewSavedText({ email: 'sent', meeting: 'none', meetingProblem: null })).toBe('The candidate was emailed, with the calendar invitation.');
    expect(interviewSavedText({ email: 'sent' })).toBe('The candidate was emailed, with the calendar invitation.');
  });

  it('a meeting refused: saved, nobody told yet, Try again or paste a link', () => {
    expect(interviewSavedText({ email: 'not_sent', meeting: 'failed', meetingProblem: 'Google refused: the account didn’t allow its calendar.' })).toBe(
      'Saved, but Google refused: the account didn’t allow its calendar. Nobody was told yet: try again or paste a link on the interview.',
    );
  });

  it('a time with conflicts: saved all the same, its warnings after (25 October 2026)', () => {
    expect(interviewSavedText({ email: 'sent', warnings: ['Sara has another interview at 2:30 PM.', 'Outside Omar’s interview hours.'] })).toBe(
      'The candidate was emailed, with the calendar invitation. Saved with warnings: Sara has another interview at 2:30 PM. Outside Omar’s interview hours.',
    );
    expect(interviewSavedText({ email: 'sent', warnings: [] })).toBe('The candidate was emailed, with the calendar invitation.');
  });
});

describe('Join', () => {
  it('the made meeting’s link, or the one pasted for an online interview; nothing hidden or not https', () => {
    expect(joinOf({ kind: 'online', location: 'https://teams.microsoft.com/l/meetup-join/x', meeting: null })).toEqual({ url: 'https://teams.microsoft.com/l/meetup-join/x', provider: 'microsoft' });
    expect(joinOf({ kind: 'online', location: 'https://meet.google.com/a', meeting: { provider: 'google', owner: 'company', joinUrl: 'https://meet.google.com/a' } })?.provider).toBe('google');
    // a developer's: the link hidden (null)
    expect(joinOf({ kind: 'online', location: null, meeting: { provider: 'zoom', owner: 'company', joinUrl: null } })).toBeNull();
    expect(joinOf({ kind: 'in_person', location: 'https://maps.example/office', meeting: null })).toBeNull();
    expect(joinOf({ kind: 'online', location: 'javascript:alert(1)', meeting: null })).toBeNull();
    expect(meetingNameOf({ kind: 'online', location: null, meeting: { provider: 'zoom', owner: 'company', joinUrl: null } })).toBe('Zoom');
    expect(meetingNameOf({ kind: 'online', location: 'https://example.com/x', meeting: null })).toBeNull();
  });

  it('Try again with a choice, or a link pasted', () => {
    expect(meetingFixForm(form([['meeting', 'company:google']]))).toEqual({ body: { meeting: 'company:google' }, errors: [] });
    expect(meetingFixForm(form([['link', ' https://zoom.us/j/9 ']]))).toEqual({ body: { link: 'https://zoom.us/j/9' }, errors: [] });
    expect(meetingFixForm(form([['link', 'zoom']])).errors).toEqual(['Give the meeting’s link in full, starting with https://.']);
    expect(meetingFixForm(form([['meeting', 'keep']])).errors).toEqual(['Choose what creates the meeting.']);
  });
});
