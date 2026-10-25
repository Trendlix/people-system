import { describe, expect, it } from 'vitest';
import { standingInBannerText, standingInNoteText } from './stand-in';

// Stand-ins (owner, 25 October 2026: "To a stand-in"): the dashboard's line and a request's note.

describe('the stand-in’s words', () => {
  it('tells the stand-in whom they stand in for and until when', () => {
    expect(standingInBannerText([{ id: 'a', fullNameEn: 'Ahmed Ali', until: '2026-11-14' }])).toBe(
      'You’re standing in for Ahmed Ali until 14/11/2026: their team’s requests come to you.',
    );
    expect(
      standingInBannerText([
        { id: 'a', fullNameEn: 'Ahmed Ali', until: '2026-11-14' },
        { id: 'b', fullNameEn: 'Sara Adel', until: '2026-11-20' },
        { id: 'c', fullNameEn: 'Omar Khaled', until: '2026-12-01' },
      ]),
    ).toBe('You’re standing in for Ahmed Ali until 14/11/2026, Sara Adel until 20/11/2026 and Omar Khaled until 01/12/2026: their teams’ requests come to you.');
  });

  it('says nothing while they stand in for nobody, or for an API from before it', () => {
    expect(standingInBannerText([])).toBeNull();
    expect(standingInBannerText(undefined)).toBeNull();
    expect(standingInBannerText(null)).toBeNull();
  });

  it('names the approver on a request decided standing in for them', () => {
    expect(standingInNoteText({ fullNameEn: 'Ahmed Ali' })).toBe('Standing in for Ahmed Ali, who is on leave: you decide this at their step until they are back.');
    expect(standingInNoteText(null)).toBeNull();
    expect(standingInNoteText(undefined)).toBeNull();
    expect(standingInNoteText({ fullNameEn: '  ' })).toBeNull();
  });
});
