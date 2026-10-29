import { describe, expect, it } from 'vitest';
import { readAgainApiPath, readAgainChoices, rereadProblemText } from './read-again';

// Read a CV again (owner, 29 October 2026: "what can we do if the OCR missed pulling data? can i perform a rerun for
// example?").

describe('reading a CV again', () => {
  it('asks the API at the applicant’s or the general CV’s address', () => {
    expect(readAgainApiPath({ applicationId: 'a1' })).toBe('/recruitment/applications/a1/read-again');
    expect(readAgainApiPath({ generalCvId: 'g 1' })).toBe('/recruitment/general-cvs/g%201/read-again');
  });

  it('offers Read again, and Read as a scan for a PDF; nothing while it is being read', () => {
    expect(readAgainChoices({ status: 'read', method: 'pdf' }).map((c) => [c.label, c.asScan])).toEqual([
      ['Read again', false],
      ['Read as a scan (OCR)', true],
    ]);
    expect(readAgainChoices({ status: 'read', method: 'docx' }).map((c) => c.label)).toEqual(['Read again']);
    expect(readAgainChoices({ status: 'failed', method: null }).map((c) => c.label)).toEqual(['Read again', 'Read as a scan (OCR)']);
    expect(readAgainChoices({ status: 'pending', method: 'pdf' })).toEqual([]);
    expect(readAgainChoices({ status: 'read', method: 'pdf' })[1].confirm).toContain('what was read before stays');
  });

  it('says why reading it again didn’t work, the earlier reading shown', () => {
    expect(rereadProblemText('The OCR service could not read it.')).toBe('Reading it again didn’t work (The OCR service could not read it), so what was read before is shown.');
    expect(rereadProblemText(null)).toBeNull();
  });
});
