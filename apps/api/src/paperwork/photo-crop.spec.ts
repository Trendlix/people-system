import { photoCropProblem } from '@trendlix/shared';
import { storedCrop } from './photo-crop.js';

// The check of the square shown in the circle beside the name (packages/shared photo-crop.ts), as the API applies it,
// and how a kept crop is read back.

describe('photoCropProblem', () => {
  const portrait = { width: 600, height: 800 };

  it('takes a square within the photo, up to its edges', () => {
    // 450 × 450 pixels of a 600 × 800 photo
    expect(photoCropProblem({ x: 0.25, y: 0.4375, w: 0.75, h: 0.5625 }, portrait)).toBeNull();
    // the largest square of a portrait photo, centred
    expect(photoCropProblem({ x: 0, y: 0.125, w: 1, h: 0.75 }, portrait)).toBeNull();
    // rounding at the edge: a millionth past it is taken
    expect(photoCropProblem({ x: 0.2500004, y: 0, w: 0.75, h: 0.5625 }, portrait)).toBeNull();
  });

  it('takes a square whose sides are within 1% of each other, and nothing further from one', () => {
    expect(photoCropProblem({ x: 0, y: 0, w: 0.5, h: 0.3735 }, portrait)).toBeNull(); // 300 × 298.8
    expect(photoCropProblem({ x: 0, y: 0, w: 0.5, h: 0.37 }, portrait)).toBe('The crop must be a square.'); // 300 × 296
    expect(photoCropProblem({ x: 0, y: 0, w: 0.5, h: 0.5 }, portrait)).toBe('The crop must be a square.');
  });

  it('takes any shape when the size of the photo could not be read', () => {
    expect(photoCropProblem({ x: 0, y: 0, w: 0.5, h: 0.9 }, null)).toBeNull();
  });

  it('refuses values outside 0 to 1, or not numbers', () => {
    const say = 'The crop must be given as fractions of the photo, from 0 to 1.';
    expect(photoCropProblem({ x: -0.1, y: 0, w: 0.5, h: 0.375 }, portrait)).toBe(say);
    expect(photoCropProblem({ x: 0, y: 0, w: 1.2, h: 0.9 }, portrait)).toBe(say);
    expect(photoCropProblem({ x: Number.NaN, y: 0, w: 0.5, h: 0.375 }, portrait)).toBe(say);
    expect(photoCropProblem({ x: '0' as unknown as number, y: 0, w: 0.5, h: 0.375 }, portrait)).toBe(say);
  });

  it('refuses a square smaller than a twentieth of the photo, or past its edges', () => {
    expect(photoCropProblem({ x: 0, y: 0, w: 0.04, h: 0.03 }, portrait)).toBe('The crop is too small: zoom out a little.');
    expect(photoCropProblem({ x: 0.5, y: 0, w: 0.75, h: 0.5625 }, portrait)).toBe('The crop goes past the edge of the photo.');
    expect(photoCropProblem({ x: 0, y: 0.5, w: 0.75, h: 0.5625 }, portrait)).toBe('The crop goes past the edge of the photo.');
  });
});

describe('storedCrop', () => {
  it('reads a kept crop: its four values only', () => {
    expect(storedCrop({ x: 0.1, y: 0.2, w: 0.5, h: 0.375 })).toEqual({ x: 0.1, y: 0.2, w: 0.5, h: 0.375 });
    expect(storedCrop({ x: 0.1, y: 0.2, w: 0.5, h: 0.375, extra: true })).toEqual({ x: 0.1, y: 0.2, w: 0.5, h: 0.375 });
  });

  it('gives null for none, or anything that is not a crop', () => {
    expect(storedCrop(null)).toBeNull();
    expect(storedCrop([0.1, 0.2, 0.5, 0.5])).toBeNull();
    expect(storedCrop({ x: 0.1, y: 0.2, w: '0.5', h: 0.5 })).toBeNull();
    expect(storedCrop('crop')).toBeNull();
  });
});
