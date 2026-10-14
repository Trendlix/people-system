import { assignSides } from './id-card-sides.js';

const card = (name: string, side: 'front' | 'back' | null, file = 0, confidence = 0.9) => ({ name, side, file, confidence });

describe('assignSides', () => {
  it('uses the side the card was recognised as, whatever the order', () => {
    const [front, back] = assignSides([card('a', 'back'), card('b', 'front')], 1);
    expect([front?.name, back?.name]).toEqual(['b', 'a']);
  });

  it('falls back to the files, then to the order found', () => {
    const [f1, b1] = assignSides([card('b', null, 1), card('a', null, 0)], 2);
    expect([f1?.name, b1?.name]).toEqual(['a', 'b']);
    const [f2, b2] = assignSides([card('top', null), card('bottom', null)], 1);
    expect([f2?.name, b2?.name]).toEqual(['top', 'bottom']);
    const [f3, b3] = assignSides([card('x', null), card('y', 'front')], 1);
    expect([f3?.name, b3?.name]).toEqual(['y', 'x']);
  });

  it('leaves a side empty when it was not found', () => {
    expect(assignSides([card('only', 'back')], 1).map((c) => c?.name ?? null)).toEqual([null, 'only']);
    expect(assignSides([], 1)).toEqual([null, null]);
  });
});
