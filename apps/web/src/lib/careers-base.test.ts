import { describe, expect, it } from 'vitest';
import { careersSiteFrom } from './careers-base';

// The careers site's address (25 October 2026: the careers pages moved to www.trendlix.com/en/careers): the API's, from
// Recruitment Settings; CAREERS_BASE_URL only when the API sent none; else the standard. The other hosts are made up.

describe('the careers site on the website', () => {
  it('is the API’s, else CAREERS_BASE_URL, else the standard', () => {
    expect(careersSiteFrom('https://careers.example.test/jobs', 'https://www.example.test/careers')).toBe('https://careers.example.test/jobs');
    expect(careersSiteFrom(undefined, 'https://www.example.test/careers')).toBe('https://www.example.test/careers');
    expect(careersSiteFrom(null, undefined)).toBe('https://www.trendlix.com/en/careers');
    expect(careersSiteFrom(undefined, 'not an address')).toBe('https://www.trendlix.com/en/careers');
  });
});
