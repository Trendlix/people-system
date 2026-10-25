import { describe, expect, it } from 'vitest';
import { HIDDEN, type VacancySuggestionView } from '@trendlix/shared';
import {
  addedText,
  decisionText,
  emptyText,
  inviteConfirmText,
  pausedText,
  poolText,
  readSuggestionStatus,
  reasonChips,
  scoreText,
  sourceText,
  statusChip,
  suggestedViewLabel,
  SUGGESTION_FILTERS,
  suggestionsApiPath,
  suggestionsHref,
} from './suggestions';

// Suggested From Earlier CVs on a vacancy's page (owner, 24 October 2026: "Suggest; HR adds", "Yes, HR presses 'Invite
// to apply'"): the addresses, the filter, where each came from, its reasons, what was decided. Made-up people only.

const ID = '0b8f0c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e';

const row = (extra: Partial<VacancySuggestionView> = {}): VacancySuggestionView => ({
  id: 's1',
  candidate: { id: 'c1', code: 'CAN-0007', fullName: 'Mona Example' },
  email: 'mona@example.test',
  source: { kind: 'general_cv', id: 'g1', number: 'APP-2026-0007', area: 'Video · Production', receivedAt: '2026-09-03T08:00:00.000Z' },
  score: 84,
  reasons: [],
  status: 'suggested',
  verdict: null,
  cv: null,
  invitedAt: null,
  sentTo: null,
  dismissReason: null,
  application: null,
  decidedBy: null,
  decidedAt: null,
  suggestedAt: '2026-10-24T08:00:00.000Z',
  can: { add: true, invite: true, dismiss: true },
  ...extra,
});

describe('the addresses and the filter', () => {
  it('opens the view on the vacancy’s page, suggested unless another status', () => {
    expect(suggestionsHref(ID)).toBe(`/recruitment/vacancies/${ID}?view=suggested`);
    expect(suggestionsHref(ID, 'dismissed')).toBe(`/recruitment/vacancies/${ID}?view=suggested&suggestions=dismissed`);
    expect(suggestionsApiPath(ID, 'suggested')).toBe(`/recruitment/vacancies/${ID}/suggestions`);
    expect(suggestionsApiPath(ID, 'invited')).toBe(`/recruitment/vacancies/${ID}/suggestions?status=invited`);
    expect(readSuggestionStatus({ suggestions: 'added' })).toBe('added');
    expect(readSuggestionStatus({ suggestions: ['applied', 'x'] })).toBe('applied');
    expect(readSuggestionStatus({ suggestions: 'nonsense' })).toBe('suggested');
    expect(readSuggestionStatus({})).toBe('suggested');
    expect(SUGGESTION_FILTERS).toEqual(['suggested', 'invited', 'added', 'applied', 'dismissed']);
  });

  it('labels the view and each status with its count', () => {
    expect(suggestedViewLabel(5)).toBe('Suggested From Earlier CVs (5)');
    expect(suggestedViewLabel(0)).toBe('Suggested From Earlier CVs (0)');
    expect(suggestedViewLabel(undefined)).toBe('Suggested From Earlier CVs');
    expect(statusChip('invited', { invited: 2 })).toBe('Invited (2)');
    expect(statusChip('dismissed', {})).toBe('Dismissed (0)');
    expect(emptyText('suggested')).toBe('No earlier CVs match this vacancy now.');
    expect(emptyText('dismissed')).toBe('Nobody dismissed yet.');
    expect(poolText(12)).toContain('the last 12 months');
    expect(poolText(1)).toContain('the last 1 month,');
    expect(pausedText({ paused: 'c_level', recencyMonths: 12 })).toBe('Earlier CVs are never suggested for a C-level vacancy.');
    expect(pausedText({ paused: 'not_open', recencyMonths: 12 })).toContain('isn’t taking applications');
    expect(pausedText({ paused: null, recencyMonths: 12 })).toBeNull();
  });
});

describe('a row', () => {
  it('says where it came from: a general CV with its area, or the job applied for; a developer’s code and area left out', () => {
    expect(sourceText(row())).toBe('General CV APP-2026-0007 · Video · Production, 03/09/2026');
    expect(sourceText(row({ source: { kind: 'general_cv', id: 'g1', number: HIDDEN, area: HIDDEN, receivedAt: '2026-09-03T08:00:00.000Z' } }))).toBe('General CV, 03/09/2026');
    expect(sourceText(row({ source: { kind: 'application', id: 'a1', number: 'APP-2026-0003', vacancy: { id: 'v2', number: 'VAC-2026-0002', title: 'Motion Designer' }, appliedAt: '2026-05-12T09:00:00.000Z' } }))).toBe(
      'Applied for Motion Designer on 12/05/2026',
    );
    expect(sourceText(row({ source: null }))).toBe('The earlier CV has gone');
    // its position (25 October 2026: "Position, grouped by team"), with its team; Other in words, without a team
    const general = { kind: 'general_cv' as const, id: 'g1', number: 'APP-2026-0007', receivedAt: '2026-09-03T08:00:00.000Z' };
    expect(sourceText(row({ source: { ...general, area: 'Video · Production', position: 'Video Editor' } }))).toBe('General CV APP-2026-0007 · Video Editor (Video · Production), 03/09/2026');
    expect(sourceText(row({ source: { ...general, area: 'Other', position: 'Other: Photographer' } }))).toBe('General CV APP-2026-0007 · Other: Photographer, 03/09/2026');
    expect(sourceText(row({ source: { ...general, number: HIDDEN, area: HIDDEN, position: 'Video Editor' } }))).toBe('General CV · Video Editor, 03/09/2026');
  });

  // a general CV's position counts as a title (25 October 2026)
  it('says a position chosen matched the job', () => {
    expect(reasonChips([{ kind: 'title', from: 'position', matchedTitle: 'Video Editor', points: 20 }]).map((c) => c.text)).toEqual(['Position: Video Editor']);
    expect(reasonChips([{ kind: 'title', from: 'position', matchedTitle: HIDDEN, points: 20 }]).map((c) => c.text)).toEqual(['A similar position chosen']);
  });

  it('shows its reasons as chips, the years below the least asked muted, the skills found on hover', () => {
    const chips = reasonChips([
      { kind: 'area', exact: true, ofTeam: true, points: 30 },
      { kind: 'skills', found: ['Premiere Pro', 'After Effects'], listed: 4, points: 18 },
      { kind: 'title', from: 'cv', matchedTitle: 'Video Editor', points: 20 },
      { kind: 'experience', years: 1, fromCv: true, minYears: 3, met: false, points: 0 },
      { kind: 'recency', months: 1, points: 5 },
    ]);
    expect(chips.map((c) => c.text)).toEqual(['Same team', '2 of 4 key skills', 'Video Editor before', '≈ 1 y (3+ wanted)', 'Recent']);
    expect(chips.map((c) => c.muted)).toEqual([false, false, false, true, false]);
    expect(chips[1].title).toBe('Premiere Pro, After Effects');
    expect(new Set(chips.map((c) => c.key)).size).toBe(5);
    expect(scoreText(84)).toBe('84');
    expect(scoreText(120)).toBe('100');
  });

  it('says what was decided, and asks before inviting', () => {
    const hr = { email: 'hr@example.test', name: 'Hoda HR' };
    expect(decisionText(row())).toBeNull();
    expect(decisionText(row({ status: 'invited', invitedAt: '2026-10-24T08:00:00.000Z', sentTo: 'mona@example.test', decidedBy: hr }))).toBe('Invited on 24/10/2026 at mona@example.test by Hoda HR');
    expect(decisionText(row({ status: 'added', decidedAt: '2026-10-24T08:00:00.000Z', application: { id: 'a9', number: 'APP-2026-0012' }, decidedBy: hr }))).toBe('Added on 24/10/2026 (APP-2026-0012) by Hoda HR');
    expect(decisionText(row({ status: 'applied', decidedAt: '2026-10-25T08:00:00.000Z', invitedAt: '2026-10-24T08:00:00.000Z', application: { id: 'a9', number: HIDDEN } }))).toBe(
      'Applied on 25/10/2026, invited before',
    );
    expect(decisionText(row({ status: 'dismissed', decidedAt: '2026-10-24T08:00:00.000Z', decidedBy: { email: 'hr@example.test', name: null } }))).toBe('Dismissed on 24/10/2026 by hr@example.test');
    expect(inviteConfirmText(row(), 'Video Editor')).toBe("Email Mona Example at mona@example.test an invitation to apply for Video Editor? It has the job's apply link; they apply themselves.");
    expect(addedText('APP-2026-0012')).toBe('Added to the vacancy as APP-2026-0012, at Applied.');
    expect(addedText(HIDDEN)).toBe('Added to the vacancy, at Applied.');
  });
});
