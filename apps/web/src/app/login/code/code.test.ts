import { describe, expect, it } from 'vitest';
import { resendIn, resendLabel } from './code';

// Signing in with a code by email (owner, 31 October 2026): a new code a minute after the last.
describe('asking for a new code', () => {
  it('waits a minute from the last, then offers it', () => {
    const sent = 1_000_000;
    expect(resendIn(sent, sent)).toBe(60);
    expect(resendIn(sent, sent + 18_200)).toBe(42);
    expect(resendIn(sent, sent + 60_000)).toBe(0);
    expect(resendIn(null, sent)).toBe(0);
    expect(resendLabel(42)).toBe('Send a new code in 0:42');
    expect(resendLabel(60)).toBe('Send a new code in 1:00');
    expect(resendLabel(0)).toBe('Send a new code');
  });
});
