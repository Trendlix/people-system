// Phone photos (often 3–8 MB) are made smaller in the browser before they are uploaded: uploads pass through the web
// app on Vercel, which accepts at most 4.5 MB per request, and OCR reads a 2,200-pixel photo as well as a
// 12-megapixel one. The photo is also turned the right way up (from its EXIF data) and saved as JPEG.

const MAX_SIDE = 2200;
const QUALITY = 0.88;
const SMALL_ENOUGH = 1.5 * 1024 * 1024;

/**
 * The photo made smaller: at most `maxSide` pixels on its long side (a whole scanner page with an ID card on it needs
 * more than a photo of the card alone, e.g. 3000), as JPEG. Small files, and anything that is not a photo, stay as they are.
 */
export async function shrinkPhoto(file: File, maxSide = MAX_SIDE): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size <= SMALL_ENOUGH) return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.fillStyle = '#ffffff'; // a transparent PNG would otherwise turn black as JPEG
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], `${file.name.replace(/\.[^.]*$/, '') || 'photo'}.jpg`, { type: 'image/jpeg' });
  } catch {
    return file; // an image the browser cannot open goes as it is; the API checks it
  }
}

/** The form's data with the photos in `keys` made smaller. */
export async function withSmallerPhotos(fd: FormData, keys: string[]): Promise<FormData> {
  for (const key of keys) {
    const value = fd.get(key);
    if (value instanceof File && value.size > 0) fd.set(key, await shrinkPhoto(value));
  }
  return fd;
}
