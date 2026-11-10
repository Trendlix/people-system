import type { Pt } from './card';

// For the tests of the ID scan only (flatten.test.ts): a phone held over a flat card or page, and where the corners of a
// flat rectangle show on the photo it takes. The geometry of a camera only: no picture, and nothing of a real card or
// person. Ported from Prime ERP (Trendlix), production/web/src/testing/camera.ts at commit c6646b8 (10 November 2026).

/**
 * How the phone is held over the rectangle: turned by `tilt` degrees about the rectangle's across (one long side further
 * from the lens than the other), by `yaw` about its down, by `roll` in the picture; its middle moved across the picture
 * by (dx, dy) points; `size`: points of the picture to a point of the rectangle, at its middle.
 */
export interface Pose {
  tilt?: number;
  yaw?: number;
  roll?: number;
  dx?: number;
  dy?: number;
  size?: number;
}

const rad = (d: number) => (d * Math.PI) / 180;

/**
 * Where each corner of a rectangle `w` by `h` shows on a photo W by H taken with a lens of focal length `f` points
 * looking at the middle of the photo: top left, top right, bottom right, bottom left.
 */
export function photo(W: number, H: number, f: number, w: number, h: number, { tilt = 0, yaw = 0, roll = 0, dx = 0, dy = 0, size = 1 }: Pose = {}): Pt[] {
  const [a, b, c] = [rad(tilt), rad(yaw), rad(roll)];
  const Z = f / size;
  // turned about the rectangle's across (x), then its down (y), then in the picture (z)
  const turn = ([x, y, z]: number[]) => {
    const y1 = y * Math.cos(a) - z * Math.sin(a);
    const z1 = y * Math.sin(a) + z * Math.cos(a);
    const x2 = x * Math.cos(b) + z1 * Math.sin(b);
    const z2 = -x * Math.sin(b) + z1 * Math.cos(b);
    return [x2 * Math.cos(c) - y1 * Math.sin(c), x2 * Math.sin(c) + y1 * Math.cos(c), z2];
  };
  const corners: Pt[] = [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ];
  return corners.map(([x, y]) => {
    const p = turn([x, y, 0]);
    const z = p[2] + Z;
    return [W / 2 + (f * (p[0] + (dx * Z) / f)) / z, H / 2 + (f * (p[1] + (dy * Z) / f)) / z] as Pt;
  });
}
