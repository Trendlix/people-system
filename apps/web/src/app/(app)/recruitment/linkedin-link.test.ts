import { describe, expect, it } from 'vitest';
import { HIDDEN } from '@trendlix/shared';
import { linkedinShown } from './linkedin-link';

// The LinkedIn link a page shows (owner, 29 October 2026: "the OCR is not filling the linkedin link like in the
// candidate profile"). Made-up people.

describe('the LinkedIn link shown', () => {
  it('is the one typed, else the CV’s, marked', () => {
    expect(linkedinShown('https://linkedin.com/in/typed', 'https://linkedin.com/in/cv')).toEqual({ href: 'https://linkedin.com/in/typed', fromCv: false });
    expect(linkedinShown(null, 'https://www.linkedin.com/in/mona-adel')).toEqual({ href: 'https://www.linkedin.com/in/mona-adel', fromCv: true });
    expect(linkedinShown(null, 'linkedin.com/in/mona-adel')).toEqual({ href: 'https://linkedin.com/in/mona-adel', fromCv: true });
    expect(linkedinShown(null, null)).toBeNull();
    expect(linkedinShown(undefined, undefined)).toBeNull();
  });

  it('is nothing a developer could open: masked either way', () => {
    expect(linkedinShown(HIDDEN, null)).toBeNull();
    expect(linkedinShown(null, HIDDEN)).toBeNull();
  });
});
