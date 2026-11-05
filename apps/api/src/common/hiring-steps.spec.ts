import { namesLine, reviewDoneNotice, reviewWaitingEmail, reviewWaitingNotice, suggestionLabel, suggestionShown } from '@trendlix/shared';

// The words of the reviews and the hiring manager's suggestion (packages/shared hiring-steps.ts; the recruitment tree,
// owner, 3 November 2026). Every person here is invented.

describe('the words', () => {
  it('says the hiring manager’s suggestion at the interview or the offer', () => {
    expect(suggestionLabel('next', 'interview')).toBe('Next step');
    expect(suggestionLabel('reject', 'offer')).toBe('Reject');
    expect(suggestionShown('reject', 'interview')).toBe('Hiring manager suggests: Reject');
  });

  it('tells a reviewer once a batch reaches their review, in the app and by email', () => {
    // the recruiter's manager's Final Review (5 November 2026: Review 2 is the Final Review)
    expect(reviewWaitingNotice('Video Editor', ['Mona Ali', 'Omar Said'], 'review_2')).toEqual({
      title: '2 applicants for Video Editor wait for your final review: pass or reject them',
      body: 'Mona Ali, Omar Said',
    });
    expect(reviewWaitingNotice('Video Editor', ['Mona Ali'], 'applied').title).toBe('1 applicant for Video Editor wait for your review: pass or reject them');
    const mail = reviewWaitingEmail('Video Editor', ['Mona Ali'], 'https://people.example/recruitment/my-hiring', 'review_2');
    expect(mail.subject).toBe('1 applicant for Video Editor wait for your final review: pass or reject them');
    expect(mail.text).toContain('Please pass or reject them on My Hiring: https://people.example/recruitment/my-hiring');
  });

  it('tells HR of a batch decided at a review', () => {
    expect(reviewDoneNotice('Video Editor', 'Final Review', 3, 1)).toEqual({ title: 'Final Review of Video Editor: 3 passed, 1 rejected', body: 'Video Editor' });
    expect(reviewDoneNotice('Video Editor', 'Final Review', 0, 0).title).toBe('Final Review of Video Editor: nothing changed');
  });

  it('lists names, the first five and how many more', () => {
    expect(namesLine(['A', 'B'])).toBe('A, B');
    expect(namesLine(['A', 'B', 'C', 'D', 'E', 'F', 'G'])).toBe('A, B, C, D, E and 2 more');
  });
});
