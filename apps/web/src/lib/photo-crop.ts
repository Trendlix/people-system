import { PHOTO_CROP_MIN, type PhotoCrop } from '@trendlix/shared';
import { clamp } from './page-frame';

// The arithmetic of cropping the picture beside the name (owner's request, 16 October 2026: "allow me to crop the photo
// beside the name to make the face bigger without affecting the uploaded full photo"): the square of the personal photo
// shown in the circle, how the crop window moves and zooms the photo under its frame, and where the picture sits in the
// circle to show exactly that square. Nothing is drawn here: pure, tested in photo-crop.test.ts.

/** The photo's size as shown (upright by its EXIF orientation, as the browser shows it), in pixels. */
export interface PhotoSize {
  width: number;
  height: number;
}

/**
 * Where the crop window is on the photo: the middle of the square under its frame, in pixels of the photo, and how far
 * it is zoomed in: 1 is the largest square the photo holds (the whole photo, as the circle shows one not cropped), 2 a
 * square half as wide.
 */
export interface CropView {
  cx: number;
  cy: number;
  zoom: number;
}

/** A point in the frame, as fractions of its side from its top left: its middle is { x: 0.5, y: 0.5 }. */
export interface FramePoint {
  x: number;
  y: number;
}

const MIDDLE: FramePoint = { x: 0.5, y: 0.5 };

/** One step of the zoom: + and −, and the buttons beside the slider. */
export const ZOOM_STEP = 1.25;

/** How far an arrow key moves the photo: a fiftieth of the frame, a tenth with Shift. */
const KEY_STEP = 0.02;
const KEY_STEP_SHIFT = 0.1;

/** Six decimals: a crop is kept to a millionth of the photo, a fraction of a pixel. */
const round = (v: number) => Math.round(v * 1e6) / 1e6;

const shortSide = ({ width, height }: PhotoSize) => Math.min(width, height);

/**
 * How far the window zooms in at most: to the smallest square the API takes, a twentieth of the photo's width and of its
 * height (PHOTO_CROP_MIN), so a twentieth of its longer side.
 */
export function maxZoom(size: PhotoSize): number {
  return Math.max(1, shortSide(size) / (PHOTO_CROP_MIN * Math.max(size.width, size.height)));
}

/** The side of the square under the frame, in pixels of the photo. */
export const squareSide = (view: CropView, size: PhotoSize) => shortSide(size) / view.zoom;

/** The window kept within bounds: zoomed from 1 to maxZoom, and the square inside the photo. */
export function clampView(view: CropView, size: PhotoSize): CropView {
  const zoom = clamp(view.zoom, 1, maxZoom(size));
  const half = shortSide(size) / zoom / 2;
  return { zoom, cx: clamp(view.cx, half, size.width - half), cy: clamp(view.cy, half, size.height - half) };
}

/** The whole photo: the largest square it holds, in its middle (how the circle shows a photo that isn't cropped). */
export const wholeView = (size: PhotoSize): CropView => ({ zoom: 1, cx: size.width / 2, cy: size.height / 2 });

/** Where the window opens: on the crop HR saved, else on the whole photo. */
export function viewOf(crop: PhotoCrop | null | undefined, size: PhotoSize): CropView {
  if (!crop) return wholeView(size);
  // the square's side, its width and height in pixels being the same within rounding
  const side = (crop.w * size.width + crop.h * size.height) / 2;
  return clampView({ zoom: shortSide(size) / side, cx: (crop.x + crop.w / 2) * size.width, cy: (crop.y + crop.h / 2) * size.height }, size);
}

/** The square under the frame as fractions of the photo, unrounded: for showing it while it moves. */
function exactCrop(view: CropView, size: PhotoSize): PhotoCrop {
  const kept = clampView(view, size);
  const side = squareSide(kept, size);
  return { x: (kept.cx - side / 2) / size.width, y: (kept.cy - side / 2) / size.height, w: side / size.width, h: side / size.height };
}

/** The crop to save: the square under the frame as fractions of the photo, to six decimals, never past its edges. */
export function cropOf(view: CropView, size: PhotoSize): PhotoCrop {
  const exact = exactCrop(view, size);
  const w = round(exact.w);
  const h = round(exact.h);
  return { x: clamp(round(exact.x), 0, round(1 - w)), y: clamp(round(exact.y), 0, round(1 - h)), w, h };
}

/** The window once the photo is dragged by (dx, dy), as fractions of the frame's side: the square goes the other way. */
export function panView(view: CropView, dx: number, dy: number, size: PhotoSize): CropView {
  const side = squareSide(view, size);
  return clampView({ ...view, cx: view.cx - dx * side, cy: view.cy - dy * side }, size);
}

/**
 * The window zoomed to `zoom`, keeping the point of the photo under `at` where it is: the middle of the frame for the
 * slider and the keys, the pointer for the mouse wheel, between the fingers for a pinch.
 */
export function zoomView(view: CropView, zoom: number, size: PhotoSize, at: FramePoint = MIDDLE): CropView {
  const side = squareSide(view, size);
  const px = view.cx + (at.x - 0.5) * side;
  const py = view.cy + (at.y - 0.5) * side;
  const z = clamp(zoom, 1, maxZoom(size));
  const next = shortSide(size) / z;
  return clampView({ zoom: z, cx: px - (at.x - 0.5) * next, cy: py - (at.y - 0.5) * next }, size);
}

/**
 * What a key does in the window: the arrow keys move the photo, as dragging it does (a fiftieth of the frame, a tenth
 * with Shift), + and − zoom in and out by a step. Null for any other key.
 */
export function keyView(view: CropView, key: string, shift: boolean, size: PhotoSize): CropView | null {
  const step = shift ? KEY_STEP_SHIFT : KEY_STEP;
  switch (key) {
    case 'ArrowLeft':
      return panView(view, -step, 0, size);
    case 'ArrowRight':
      return panView(view, step, 0, size);
    case 'ArrowUp':
      return panView(view, 0, -step, size);
    case 'ArrowDown':
      return panView(view, 0, step, size);
    case '+':
    case '=':
      return zoomView(view, view.zoom * ZOOM_STEP, size);
    case '-':
    case '_':
      return zoomView(view, view.zoom / ZOOM_STEP, size);
    default:
      return null;
  }
}

/** The zoom a turn of the mouse wheel gives: up zooms in, down zooms out, more for a larger turn. */
export const wheelZoom = (zoom: number, deltaY: number) => zoom * Math.exp(-clamp(deltaY, -200, 200) * 0.002);

/** Where the zoom slider stands: in steps that feel alike from 1× to the most (the zoom's logarithm), and back. */
export const sliderOf = (zoom: number) => Math.log2(zoom);
export const zoomOfSlider = (value: number) => 2 ** value;

/** "1.0×", "2.5×" */
export const zoomLabel = (zoom: number) => `${zoom.toFixed(1)}×`;

/** Whether the window shows the whole photo (zoomed out, in the middle): the same as no crop. */
export function isWhole(view: CropView, size: PhotoSize): boolean {
  const whole = wholeView(size);
  const close = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * shortSide(size);
  return Math.abs(view.zoom - 1) < 1e-9 && close(view.cx, whole.cx) && close(view.cy, whole.cy);
}

/** Percentages, kept short. */
const pct = (v: number) => `${Math.round(v * 1e4) / 1e4}%`;

/**
 * Where the picture sits in a square (the circle beside the name, or the crop window's frame) to show exactly `crop`:
 * placed absolutely, as percentages of the square. The picture must not be held to the square's width (Tailwind's base
 * styles cap an image at 100%: max-w-none).
 */
export function cropStyle(crop: PhotoCrop): { width: string; height: string; left: string; top: string } {
  return { width: pct(100 / crop.w), height: pct(100 / crop.h), left: pct(-(crop.x / crop.w) * 100), top: pct(-(crop.y / crop.h) * 100) };
}

/** The picture's place in the crop window's frame, as it moves: cropStyle of the square under the frame, unrounded. */
export const viewStyle = (view: CropView, size: PhotoSize) => cropStyle(exactCrop(view, size));
