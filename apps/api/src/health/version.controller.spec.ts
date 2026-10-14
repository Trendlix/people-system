import { VersionController } from './version.controller.js';

describe('VersionController', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('answers with the build stamp', () => {
    process.env.PEOPLE_COMMIT = '4e2d514';
    process.env.PEOPLE_COMMITTED = '2026-10-14T16:20:00+03:00';
    expect(new VersionController().version()).toEqual({ commit: '4e2d514', committed: '2026-10-14T16:20:00+03:00' });
  });

  it('answers with nulls when the image was built without a stamp', () => {
    process.env.PEOPLE_COMMIT = '';
    delete process.env.PEOPLE_COMMITTED;
    expect(new VersionController().version()).toEqual({ commit: null, committed: null });
  });
});
