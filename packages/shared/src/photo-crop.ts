// The picture beside an employee's name, cropped (owner's request, 16 October 2026: "allow me to crop the photo beside
// the name to make the face bigger without affecting the uploaded full photo"). HR chooses the square of the personal
// photo shown in the circle; the uploaded photo itself never changes. Without a crop, the whole photo is shown, centred.

/**
 * The square shown in the circle, as fractions of the photo as shown (a JPEG turned upright by its EXIF orientation):
 * its left and top, its width as a fraction of the photo's width and its height as a fraction of its height. A square in
 * pixels, so `w` and `h` differ on a photo that isn't square itself.
 */
export interface PhotoCrop {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The smallest square: a twentieth of the photo's width and of its height, so a crop never zooms past a blur. */
export const PHOTO_CROP_MIN = 0.05;

/** How far a crop's width and height in pixels may differ and still be a square: 1% of the larger (rounding). */
export const PHOTO_CROP_SQUARE_TOLERANCE = 0.01;

/** Room for rounding where a crop meets the photo's right or bottom edge (x + w, y + h): a millionth. */
const EDGE_ROUNDING = 1e-6;

/**
 * What is wrong with a crop, said for HR, or null when it is a square within the photo: every value a number from 0 to
 * 1, each side at least PHOTO_CROP_MIN, nothing past the photo's edges, and a square on a photo `size` (as shown). When
 * the photo's size can't be read, any shape is taken.
 */
export function photoCropProblem(crop: PhotoCrop, size: { width: number; height: number } | null): string | null {
  const values = [crop.x, crop.y, crop.w, crop.h];
  if (!values.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1)) {
    return 'The crop must be given as fractions of the photo, from 0 to 1.';
  }
  if (crop.w < PHOTO_CROP_MIN || crop.h < PHOTO_CROP_MIN) return 'The crop is too small: zoom out a little.';
  if (crop.x + crop.w > 1 + EDGE_ROUNDING || crop.y + crop.h > 1 + EDGE_ROUNDING) return 'The crop goes past the edge of the photo.';
  if (size) {
    const across = crop.w * size.width;
    const down = crop.h * size.height;
    if (Math.abs(across - down) > PHOTO_CROP_SQUARE_TOLERANCE * Math.max(across, down)) return 'The crop must be a square.';
  }
  return null;
}
