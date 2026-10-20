// Draws the app's icons, notification icon and splash icon for Android, and the wordmark in the bundled pages, from the
// owner's two logos in assets/source (owner, 20 October 2026: "App Name: Trendlix People", with the logos for the icon;
// apps/mobile/README.md, Phase 5). Run from the repo root after changing a logo:
//
//   npm run assets -w @trendlix/mobile
//
// then look at the pictures (see assets/README.md) and commit them. It writes only PNGs under android/app/src/main/res
// and the wordmark's data address inside www/index.html and www/offline.html; the XML that uses them is kept by hand.
// sharp (an exact devDependency of the workspace) does the drawing.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const mobile = path.resolve(here, '..');
const res = path.join(mobile, 'android/app/src/main/res');
const www = path.join(mobile, 'www');

/** A white "T" with a red dot on solid black, 1181 × 1181. */
const ICON = path.join(here, 'source/trendlix-icon.jpg');
/** "TrendLIX." in black and red on transparent, 6064 × 1005. */
const WORDMARK = path.join(here, 'source/trendlix-wordmark.png');

/** The dot's red, the icon's most common red pixel (also android res/values/colors.xml trendlix_red). */
const RED = { r: 226, g: 29, b: 59 }; // #E21D3B
const WHITE = { r: 255, g: 255, b: 255 };

/** Android's density buckets, as a multiple of a dp. */
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

/** How wide the wordmark is drawn in the pages' data address (shown 240 CSS px wide: sharp up to 4x screens). */
const WORDMARK_WIDTH = 960;

// ---------- the mark: the T and the dot, out of the JPG ----------

/** The box around the pixels that pass `test`, as { left, top, right, bottom } (inclusive). */
function boxOf(data, size, test) {
  let left = size;
  let top = size;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 3;
      if (test(data[i], data[i + 1], data[i + 2])) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < 0) throw new Error('The icon has no mark in it.');
  return { left, top, right, bottom };
}

const grown = (box, by) => ({ left: box.left - by, top: box.top - by, right: box.right + by, bottom: box.bottom + by });
const inside = (box, x, y) => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;

/**
 * The T and the dot on transparent, at the JPG's own size and place (so the owner's layout is kept): each pixel's
 * colour is the T's white or the dot's red exactly, and how much of it the pixel is (its edge) is read back out of the
 * black. The T and the dot don't touch, so which one a pixel belongs to is told by where it is. JPEG noise in the black
 * and the source's 1 px grey frame are dropped.
 */
async function extractMark() {
  const { data, info } = await sharp(ICON).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== info.height) throw new Error('The icon must be square.');
  const size = info.width;
  const mark = grown(boxOf(data, size, (r, g, b) => r > 128 || g > 128 || b > 128), 6);
  const dot = grown(boxOf(data, size, (r, g) => r > 150 && g < 90), 12);
  const redLength = RED.r * RED.r + RED.g * RED.g + RED.b * RED.b;
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 3;
      const o = (y * size + x) * 4;
      if (!inside(mark, x, y)) continue;
      const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
      const isDot = inside(dot, x, y);
      let a = isDot ? (r * RED.r + g * RED.g + b * RED.b) / redLength : (r + g + b) / (3 * 255);
      if (a < 0.06) a = 0;
      else if (a > 0.96) a = 1;
      const c = isDot ? RED : WHITE;
      out[o] = c.r;
      out[o + 1] = c.g;
      out[o + 2] = c.b;
      out[o + 3] = Math.round(Math.min(1, a) * 255);
    }
  }
  // the mark's own box, from what was kept (for the notification icon, which is cut to it)
  let box = null;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (out[(y * size + x) * 4 + 3] < 128) continue;
      box = box
        ? { left: Math.min(box.left, x), top: Math.min(box.top, y), right: Math.max(box.right, x), bottom: Math.max(box.bottom, y) }
        : { left: x, top: y, right: x, bottom: y };
    }
  }
  if (!box) throw new Error('Nothing of the mark was kept.');
  return { rgba: out, size, box };
}

/** The mark as a sharp image, in its colours or as one white silhouette. */
function markImage(mark, silhouette = false) {
  let pixels = mark.rgba;
  if (silhouette) {
    pixels = Buffer.from(mark.rgba);
    for (let o = 0; o < pixels.length; o += 4) {
      pixels[o] = 255;
      pixels[o + 1] = 255;
      pixels[o + 2] = 255;
    }
  }
  return sharp(pixels, { raw: { width: mark.size, height: mark.size, channels: 4 } });
}

/**
 * A drawn mark's colours put back to the T's white and the dot's red exactly: Lanczos' sharp edges brighten a few edge
 * pixels past the colours (the T and the dot are far enough apart never to blend). How much of each pixel is kept.
 */
async function snapColours(image) {
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  for (let o = 0; o < data.length; o += 4) {
    if (data[o + 3] === 0) continue;
    const c = data[o] - Math.max(data[o + 1], data[o + 2]) > 80 ? RED : WHITE;
    data[o] = c.r;
    data[o + 1] = c.g;
    data[o + 2] = c.b;
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
}

/** The whole square (the mark where the JPG has it), drawn `px` wide, as PNG bytes. */
const squareAt = async (mark, px, silhouette) => (await snapColours(markImage(mark, silhouette).resize(px, px, { kernel: 'lanczos3' }))).png().toBuffer();

const transparent = { r: 0, g: 0, b: 0, alpha: 0 };

/** The square drawn `inner` px wide in the middle of a transparent `canvas` px square. */
async function centred(mark, canvas, inner, silhouette = false) {
  const pad = (canvas - inner) / 2;
  if (!Number.isInteger(pad)) throw new Error(`${canvas} and ${inner} don't centre on whole pixels.`);
  return sharp(await squareAt(mark, inner, silhouette))
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: transparent })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

/** A black shape (`svg`, the canvas's size) with the square drawn `inner` px wide in its middle, cut to the shape. */
async function onBlack(mark, canvas, inner, shape) {
  const pad = (canvas - inner) / 2;
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${canvas}" height="${canvas}">${shape}</svg>`);
  const base = await sharp(svg).png().toBuffer();
  const drawn = await sharp({ create: { width: canvas, height: canvas, channels: 4, background: transparent } })
    .composite([
      { input: base, left: 0, top: 0 },
      { input: await squareAt(mark, inner, false), left: pad, top: pad },
    ])
    .png()
    .toBuffer();
  // cut to the shape: what is outside it (the mark never is) stays transparent
  return sharp(drawn)
    .composite([{ input: base, blend: 'dest-in' }])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

/** The mark alone (its own box), as a white silhouette `height` px tall in the middle of a transparent `canvas` px square. */
async function silhouetteIcon(mark, canvas, height) {
  const { left, top, right, bottom } = mark.box;
  const box = { left: left - 2, top: top - 2, width: right - left + 5, height: bottom - top + 5 };
  const width = Math.round((height * box.width) / box.height);
  const glyph = await markImage(mark, true).extract(box).resize(width, height, { kernel: 'lanczos3', fit: 'fill' }).png().toBuffer();
  return sharp({ create: { width: canvas, height: canvas, channels: 4, background: transparent } })
    .composite([{ input: glyph, left: Math.floor((canvas - width) / 2), top: Math.floor((canvas - height) / 2) }])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

async function save(file, bytes) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
  console.log(`${path.relative(mobile, file)}  ${(bytes.length / 1024).toFixed(1)} KB`);
}

// ---------- what is drawn ----------

const mark = await extractMark();

for (const [bucket, d] of Object.entries(DENSITIES)) {
  const mipmap = path.join(res, `mipmap-${bucket}`);
  const drawable = path.join(res, `drawable-${bucket}`);

  // Adaptive icon (Android 8+): 108 dp layers; the JPG's square is the 72 dp a mask shows, so the mark (52 dp tall)
  // stays inside the 66 dp safe zone whatever the mask. The background is the colour @color/ic_launcher_background.
  await save(path.join(mipmap, 'ic_launcher_foreground.png'), await centred(mark, 108 * d, 72 * d));
  // Android 13's themed icons: the same, as one white silhouette (the launcher tints it)
  await save(path.join(mipmap, 'ic_launcher_monochrome.png'), await centred(mark, 108 * d, 72 * d, true));

  // Legacy icons (Android 7, before adaptive icons): 48 dp, a rounded black square of 40 dp and a black circle of 44 dp.
  const legacy = 48 * d;
  const square = 40 * d;
  const offset = (legacy - square) / 2;
  await save(
    path.join(mipmap, 'ic_launcher.png'),
    await onBlack(mark, legacy, square, `<rect x="${offset}" y="${offset}" width="${square}" height="${square}" rx="${4 * d}" fill="#000"/>`),
  );
  const round = 44 * d;
  await save(path.join(mipmap, 'ic_launcher_round.png'), await onBlack(mark, legacy, round, `<circle cx="${legacy / 2}" cy="${legacy / 2}" r="${round / 2}" fill="#000"/>`));

  // The notification's small icon: 24 dp, the mark 20 dp tall in white (Android draws it as a shape in one colour)
  await save(path.join(drawable, 'ic_stat_notify.png'), await silhouetteIcon(mark, 24 * d, 20 * d));

  // The splash icon: 288 dp, as Android 12's splash screen (and core-splashscreen before it) draws it, masked to the
  // middle 192 dp circle: the JPG's square is that 192 dp, so the mark is as on the adaptive icon, larger
  await save(path.join(drawable, 'splash_icon.png'), await centred(mark, 288 * d, 192 * d));
}

// The wordmark for the bundled pages, as a data address in each (the offline page can load nothing from the network)
const wordmark = await sharp(WORDMARK)
  .resize({ width: WORDMARK_WIDTH, kernel: 'lanczos3' })
  .png({ palette: true, colours: 64, compressionLevel: 9, effort: 10 })
  .toBuffer();
const address = `data:image/png;base64,${wordmark.toString('base64')}`;
for (const page of ['index.html', 'offline.html']) {
  const file = path.join(www, page);
  const html = await readFile(file, 'utf8');
  const marker = /(<img class="wordmark"[^>]*?\ssrc=")[^"]*(")/;
  if (!marker.test(html)) throw new Error(`${page} has no <img class="wordmark" … src="…">.`);
  const next = html.replace(marker, `$1${address}$2`);
  await writeFile(file, next);
  console.log(`www/${page}  wordmark ${(wordmark.length / 1024).toFixed(1)} KB, page ${(Buffer.byteLength(next) / 1024).toFixed(1)} KB`);
}
