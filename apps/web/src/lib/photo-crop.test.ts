// Cropping the picture beside the name: the crop window's moves and zoom, the crop it saves, and the circle's picture.
import { photoCropProblem, type PhotoCrop } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import {
  clampView,
  cropOf,
  cropStyle,
  isWhole,
  keyView,
  maxZoom,
  panView,
  sliderOf,
  squareSide,
  viewOf,
  viewStyle,
  wheelZoom,
  wholeView,
  zoomOfSlider,
  zoomView,
  ZOOM_STEP,
  type CropView,
} from './photo-crop';

const PORTRAIT = { width: 600, height: 800 };
const LANDSCAPE = { width: 4000, height: 3000 };

const near = (a: PhotoCrop, b: PhotoCrop, digits = 6) => {
  for (const k of ['x', 'y', 'w', 'h'] as const) expect(a[k]).toBeCloseTo(b[k], digits);
};
const nearView = (a: CropView, b: CropView) => {
  for (const k of ['cx', 'cy', 'zoom'] as const) expect(a[k]).toBeCloseTo(b[k], 6);
};

describe('where the crop window opens', () => {
  it('on the whole photo when there is no crop: the largest square, in the middle', () => {
    expect(viewOf(null, PORTRAIT)).toEqual({ zoom: 1, cx: 300, cy: 400 });
    expect(cropOf(viewOf(null, PORTRAIT), PORTRAIT)).toEqual({ x: 0, y: 0.125, w: 1, h: 0.75 });
    expect(cropOf(viewOf(undefined, LANDSCAPE), LANDSCAPE)).toEqual({ x: 0.125, y: 0, w: 0.75, h: 1 });
    expect(isWhole(viewOf(null, PORTRAIT), PORTRAIT)).toBe(true);
  });

  it('on the saved crop, which it gives back as it was', () => {
    const saved = { x: 0.25, y: 0.4375, w: 0.75, h: 0.5625 }; // 450 × 450 pixels at the bottom right
    const view = viewOf(saved, PORTRAIT);
    nearView(view, { zoom: 600 / 450, cx: 375, cy: 575 });
    expect(cropOf(view, PORTRAIT)).toEqual(saved);
    expect(isWhole(view, PORTRAIT)).toBe(false);
  });

  it('keeps a saved crop that no longer fits inside the photo', () => {
    const view = viewOf({ x: 0.9, y: 0.9, w: 0.5, h: 0.375 }, PORTRAIT);
    const crop = cropOf(view, PORTRAIT);
    expect(crop.x + crop.w).toBeLessThanOrEqual(1);
    expect(crop.y + crop.h).toBeLessThanOrEqual(1);
    expect(photoCropProblem(crop, PORTRAIT)).toBeNull();
  });
});

describe('moving and zooming the photo under the frame', () => {
  it('drags the photo: the square goes the other way, by the same share of the frame', () => {
    const view = { zoom: 2, cx: 300, cy: 400 }; // a 300-pixel square
    // the photo dragged a tenth of the frame to the right: the square moves 30 pixels left
    nearView(panView(view, 0.1, 0, PORTRAIT), { zoom: 2, cx: 270, cy: 400 });
    nearView(panView(view, 0, -0.2, PORTRAIT), { zoom: 2, cx: 300, cy: 460 });
  });

  it('never lets the square leave the photo', () => {
    const view = { zoom: 2, cx: 300, cy: 400 };
    nearView(panView(view, 5, 5, PORTRAIT), { zoom: 2, cx: 150, cy: 150 });
    nearView(panView(view, -5, -5, PORTRAIT), { zoom: 2, cx: 450, cy: 650 });
    // zoomed out, the whole photo's width: it moves only up and down
    nearView(panView(wholeView(PORTRAIT), 1, 0.1, PORTRAIT), { zoom: 1, cx: 300, cy: 340 });
  });

  it('zooms from the whole photo to a twentieth of its longer side, no further', () => {
    expect(maxZoom(PORTRAIT)).toBeCloseTo(15, 9); // 600 / (0.05 × 800)
    expect(maxZoom({ width: 500, height: 500 })).toBeCloseTo(20, 9);
    expect(maxZoom({ width: 3000, height: 100 })).toBe(1); // a strip: the whole of it only
    expect(zoomView(wholeView(PORTRAIT), 100, PORTRAIT).zoom).toBeCloseTo(15, 9);
    expect(zoomView(wholeView(PORTRAIT), 0.2, PORTRAIT).zoom).toBe(1);
    // the smallest square is still taken by the API
    const smallest = cropOf(zoomView(wholeView(PORTRAIT), 100, PORTRAIT), PORTRAIT);
    expect(smallest.h).toBe(0.05);
    expect(photoCropProblem(smallest, PORTRAIT)).toBeNull();
  });

  it('zooms about the middle of the frame, or keeps the point under the pointer where it is', () => {
    const view = { zoom: 2, cx: 300, cy: 400 };
    nearView(zoomView(view, 4, PORTRAIT), { zoom: 4, cx: 300, cy: 400 });
    // the point at the frame's top left quarter (a quarter in from each side) stays under the pointer
    const at = { x: 0.25, y: 0.25 };
    const before = { x: view.cx + (at.x - 0.5) * squareSide(view, PORTRAIT), y: view.cy + (at.y - 0.5) * squareSide(view, PORTRAIT) };
    const zoomed = zoomView(view, 3, PORTRAIT, at);
    const side = squareSide(zoomed, PORTRAIT);
    expect(zoomed.cx + (at.x - 0.5) * side).toBeCloseTo(before.x, 9);
    expect(zoomed.cy + (at.y - 0.5) * side).toBeCloseTo(before.y, 9);
  });

  it('zooms out within the photo: a square at an edge is brought back inside', () => {
    const atEdge = clampView({ zoom: 4, cx: 0, cy: 0 }, PORTRAIT); // 150 pixels, at the top left corner
    nearView(atEdge, { zoom: 4, cx: 75, cy: 75 });
    nearView(zoomView(atEdge, 1, PORTRAIT), { zoom: 1, cx: 300, cy: 300 });
  });

  it('follows the keys: the arrows move the photo as dragging does, + and − zoom by a step', () => {
    const view = { zoom: 2, cx: 300, cy: 400 };
    nearView(keyView(view, 'ArrowRight', false, PORTRAIT)!, panView(view, 0.02, 0, PORTRAIT));
    nearView(keyView(view, 'ArrowUp', true, PORTRAIT)!, panView(view, 0, -0.1, PORTRAIT));
    expect(keyView(view, '+', false, PORTRAIT)!.zoom).toBeCloseTo(2 * ZOOM_STEP, 9);
    expect(keyView(view, '=', false, PORTRAIT)!.zoom).toBeCloseTo(2 * ZOOM_STEP, 9);
    expect(keyView(view, '-', false, PORTRAIT)!.zoom).toBeCloseTo(2 / ZOOM_STEP, 9);
    expect(keyView(view, 'Enter', false, PORTRAIT)).toBeNull();
  });

  it('zooms in when the wheel turns up, out when it turns down; the slider goes evenly from 1× up', () => {
    expect(wheelZoom(2, -100)).toBeGreaterThan(2);
    expect(wheelZoom(2, 100)).toBeLessThan(2);
    expect(wheelZoom(2, 5000)).toBeCloseTo(wheelZoom(2, 200), 9); // a large turn is a step, not a jump
    expect(sliderOf(1)).toBe(0);
    expect(zoomOfSlider(sliderOf(6))).toBeCloseTo(6, 9);
  });
});

describe('the crop it saves', () => {
  it('is a square within the photo that the API takes, wherever the window is', () => {
    for (const size of [PORTRAIT, LANDSCAPE, { width: 1, height: 1 }, { width: 3024, height: 4032 }, { width: 997, height: 1361 }]) {
      for (const zoom of [1, 1.37, 2, 5.5, 100]) {
        for (const [cx, cy] of [
          [0, 0],
          [size.width / 3, size.height / 7],
          [size.width, size.height],
        ]) {
          const crop = cropOf({ zoom, cx, cy }, size);
          expect(photoCropProblem(crop, size)).toBeNull();
          expect(crop.x + crop.w).toBeLessThanOrEqual(1);
          expect(crop.y + crop.h).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('is kept to six decimals', () => {
    const crop = cropOf({ zoom: 3, cx: 333.3333333, cy: 444.4444444 }, PORTRAIT);
    for (const v of Object.values(crop)) expect(Math.round(v * 1e6) / 1e6).toBe(v);
  });
});

describe('the picture in the circle', () => {
  it('shows exactly the crop: as many circles wide as the crop goes into the photo, moved left and up by its corner', () => {
    expect(cropStyle({ x: 0.25, y: 0.4375, w: 0.75, h: 0.5625 })).toEqual({ width: '133.3333%', height: '177.7778%', left: '-33.3333%', top: '-77.7778%' });
    // the whole of a square photo: the circle's own size
    expect(cropStyle({ x: 0, y: 0, w: 1, h: 1 })).toEqual({ width: '100%', height: '100%', left: '0%', top: '0%' });
  });

  it('in the crop window, as the frame moves: the same place as the crop it saves', () => {
    const view = { zoom: 2.5, cx: 280, cy: 390 };
    const style = viewStyle(view, PORTRAIT);
    const saved = cropStyle(cropOf(view, PORTRAIT));
    for (const k of ['width', 'height', 'left', 'top'] as const) expect(parseFloat(style[k])).toBeCloseTo(parseFloat(saved[k]), 2);
    near(cropOf(viewOf(cropOf(view, PORTRAIT), PORTRAIT), PORTRAIT), cropOf(view, PORTRAIT));
  });
});
