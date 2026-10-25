import { careersKeyOk } from './careers-key.guard.js';

const KEY = 'k'.repeat(40);

describe('the careers key', () => {
  it('lets in only the exact key', () => {
    expect(careersKeyOk(KEY, KEY)).toBe(true);
    expect(careersKeyOk(`${KEY}x`, KEY)).toBe(false);
    expect(careersKeyOk('k'.repeat(39) + 'j', KEY)).toBe(false);
    expect(careersKeyOk(undefined, KEY)).toBe(false);
    expect(careersKeyOk([KEY], KEY)).toBe(false);
  });

  it('lets nobody in without a long enough key on the server', () => {
    expect(careersKeyOk('', undefined)).toBe(false);
    expect(careersKeyOk('short', 'short')).toBe(false);
  });
});
