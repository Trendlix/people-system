import { punchView, type PunchRow } from './punch-views.js';

// Presses as the API sends them (owner, 20 October 2026: "Yes, keep the spot", seen by "HR, CEO, Super Admin" and the
// employee): the place for everyone, the spot only for those who see it, and an old office press's spot from its
// location.

const decimal = (n: number) => ({ toNumber: () => n }) as unknown as NonNullable<PunchRow['latitude']>;
const HEAD = { name: 'Head office', latitude: 30.0596, longitude: 31.3462 };

const row = (more: Partial<PunchRow> = {}): PunchRow => ({
  date: new Date('2026-10-20T00:00:00Z'),
  kind: 'in',
  at: new Date('2026-10-20T06:05:00Z'),
  place: 'office',
  accuracyMetres: 12,
  flags: [],
  locationName: 'Head office',
  officeNetwork: null,
  latitude: decimal(30.0601),
  longitude: decimal(31.3465),
  ...more,
});

describe('a press as the API sends it', () => {
  it('gives everyone the place, the day, the location’s and the network’s names; never the spot or its accuracy', () => {
    const view = punchView(row({ officeNetwork: 'Main office line' }), false, [HEAD]);
    expect(view).toEqual({ date: '2026-10-20', kind: 'in', at: '2026-10-20T06:05:00.000Z', place: 'office', flags: [], locationName: 'Head office', officeNetwork: 'Main office line' });
    for (const key of ['latitude', 'longitude', 'accuracyMetres', 'pointFrom']) expect(view).not.toHaveProperty(key);
  });

  it('gives those who see it the press’s own point and accuracy', () => {
    expect(punchView(row(), true, [HEAD])).toMatchObject({ latitude: 30.0601, longitude: 31.3465, accuracyMetres: 12, pointFrom: 'press' });
  });

  it('gives an old office press its location’s point, and any other press without one none', () => {
    expect(punchView(row({ latitude: null, longitude: null }), true, [HEAD])).toMatchObject({ latitude: 30.0596, longitude: 31.3462, accuracyMetres: 12, pointFrom: 'location' });
    expect(punchView(row({ latitude: null, longitude: null, place: 'unknown', locationName: null, accuracyMetres: null }), true, [HEAD])).toMatchObject({
      latitude: null,
      longitude: null,
      accuracyMetres: null,
      pointFrom: null,
    });
  });
});
