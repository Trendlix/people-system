import { describe, expect, it } from 'vitest';
import { analyticsExcelHref, boardHref, daysFigure, daysText, dropOn, emailText, feedbackForm, interviewForm, percentFigure, readAnalyticsQuery, rejectedText, suggestionForm } from './hiring';

// Recruitment on the site, Phase 2 (owner, 22 October 2026: "where will we include the ATS?"; "interview invites go by
// email through the owner's SMTP settings").

const form = (entries: [string, string][]) => {
  const fd = new FormData();
  for (const [k, v] of entries) fd.append(k, v);
  return fd;
};

describe('the board', () => {
  it('links a vacancy’s board, and says what a drop does', () => {
    expect(boardHref('abc')).toBe('/recruitment/vacancies/abc?view=board');
    const card = { stage: 'shortlisted' as const, filteredOut: false, openOffer: false };
    expect(dropOn(card, 'interview')).toEqual({ kind: 'move', to: 'interview', needsReason: false });
    expect(dropOn(card, 'rejected')).toEqual({ kind: 'move', to: 'rejected', needsReason: true });
    expect(dropOn(card, 'offer')).toEqual({ kind: 'offer' });
    expect(dropOn(card, 'hired').kind).toBe('refused');
    expect(dropOn({ ...card, openOffer: true }, 'offer').kind).toBe('refused');
  });

  it('counts the days at a stage in words', () => {
    expect(daysText(0)).toBe('Today');
    expect(daysText(1)).toBe('1 day');
    expect(daysText(12)).toBe('12 days');
  });
});

describe('the interview form', () => {
  it('reads the day as DD/MM/YYYY and the 12-hour time, with the interviewers ticked', () => {
    const { body, errors } = interviewForm(
      form([
        ['date', '05/11/2026'],
        ['time', '2:30 PM'],
        ['minutes', '45'],
        ['kind', 'online'],
        ['location', ' https://meet.example.com/abc '],
        ['interviewerIds', 'a'],
        ['interviewerIds', 'b'],
        ['note', ''],
      ]),
    );
    expect(errors).toEqual([]);
    expect(body).toEqual({ date: '2026-11-05', time: '14:30', minutes: 45, kind: 'online', location: 'https://meet.example.com/abc', interviewerIds: ['a', 'b'], note: null });
  });

  it('says what is missing', () => {
    expect(interviewForm(form([['minutes', '45']])).errors).toEqual([
      'Choose the day of the interview, as DD/MM/YYYY.',
      'Choose the time of the interview.',
      'Choose how it is held.',
      'Choose who interviews them.',
    ]);
  });

  it('says what the candidate’s email did', () => {
    expect(emailText('sent')).toBe('The candidate was emailed, with the calendar invitation.');
    expect(emailText('not_set_up')).toContain('tell the candidate yourself');
    expect(emailText('failed')).toContain('refused');
  });
});

describe('the scorecard and the suggestion', () => {
  it('reads every rating from 1 to 5 and the recommendation', () => {
    const { body } = feedbackForm(
      form([
        ['rating_skills', '4'],
        ['rating_experience', '3'],
        ['rating_communication', '5'],
        ['rating_culture', '4'],
        ['recommendation', 'yes'],
        ['notes', 'Good eye'],
      ]),
    );
    expect(body).toEqual({ ratings: { skills: 4, experience: 3, communication: 5, culture: 4 }, recommendation: 'yes', notes: 'Good eye' });
    expect(feedbackForm(form([['rating_skills', '4']])).errors).toEqual(['Rate every criterion from 1 to 5.', 'Choose your recommendation.']);
  });

  it('reads the hiring manager’s suggestion', () => {
    expect(suggestionForm(form([['suggestion', 'reject'], ['note', ' Not the style ']])).body).toEqual({ suggestion: 'reject', note: 'Not the style' });
    expect(suggestionForm(form([['suggestion', 'maybe']])).errors).toEqual(['Suggest the next step or a rejection.']);
  });

  it('says what a rejection’s email did', () => {
    expect(rejectedText('sent')).toBe('Rejected. The candidate was emailed.');
    expect(rejectedText('not_sent')).toBe('Rejected.');
    expect(rejectedText(undefined)).toBe('Rejected.');
    expect(rejectedText('not_set_up')).toContain('nothing was sent');
  });
});

describe('the analytics', () => {
  it('reads the year (this one unless another is asked) and the department', () => {
    expect(readAnalyticsQuery({}, '2026-10-22')).toEqual({ year: 2026, departmentId: '' });
    expect(readAnalyticsQuery({ year: '2025', departmentId: '0b8f0c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e' }, '2026-10-22')).toEqual({ year: 2025, departmentId: '0b8f0c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e' });
    expect(readAnalyticsQuery({ year: '1990', departmentId: 'x' }, '2026-10-22')).toEqual({ year: 2026, departmentId: '' });
    expect(analyticsExcelHref({ year: 2026, departmentId: '' })).toBe('/recruitment/analytics/excel?year=2026');
  });

  it('shows days and percents, or a dash without one', () => {
    expect(daysFigure(null)).toBe('—');
    expect(daysFigure(1)).toBe('1 day');
    expect(daysFigure(12.5)).toBe('12.5 days');
    expect(percentFigure(66.7)).toBe('66.7%');
    expect(percentFigure(null)).toBe('—');
  });
});
