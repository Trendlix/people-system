// Product images on a draft from Claude (owner, 21 October 2026: "i want claude to add product image from its specs. is
// this applicable?", then "let the mcp connector fetch the product photo and add it / yes build it"). Claude can't pass
// image files through the connector, so it finds the maker's official image (or a reputable store's) with its web
// search and gives the link (add_product_image); the website's MCP endpoint fetches it (apps/web
// lib/connector/image-guard.ts: https only, public addresses only, at most 3 redirects, 10 seconds, 5 MB) and the API
// keeps it on the draft, at most 3 a draft. Each is marked "Product image · from <host>" with a link to its source page:
// it shows the model, not the item itself, so a person still adds a real photo for its condition and serial. Confirmed,
// the draft's product images become the asset's photos, still marked; discarded, they go with the draft. Pure code: the
// website and the API check the same bytes with it.

/** At most 3 product images a draft (they count towards the asset's 6 photos once it is confirmed). */
export const ASSET_PRODUCT_IMAGES_MAX = 3;

/** The rules a product image is fetched and kept by. */
export const PRODUCT_IMAGE_RULES = {
  /** 5 MB, enforced while it arrives. */
  maxBytes: 5 * 1024 * 1024,
  /** Each side at least 100 pixels and at most 8000. */
  minSide: 100,
  maxSide: 8000,
  /** The longest side the website keeps when it can make it smaller (as the photos the web sends: 1600 px). */
  side: 1600,
  /** Redirects followed, each checked again. */
  maxRedirects: 3,
  /** Everything, from the first address lookup to the last byte. */
  timeoutMs: 10_000,
  /** The image's link and its source page's. */
  urlMax: 2000,
  captionMax: 200,
} as const;

/** What a product image may be: never SVG (it can carry scripts), never GIF or anything else. */
export const PRODUCT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ProductImageType = (typeof PRODUCT_IMAGE_TYPES)[number];

/** A photo of the item itself (taken or chosen by a person), or the maker's product image (from a draft from Claude). */
export const ASSET_PHOTO_KINDS = ['photo', 'product'] as const;
export type AssetPhotoKind = (typeof ASSET_PHOTO_KINDS)[number];

/** Where a product image came from, on a draft and on the asset's photos. */
export interface ProductImageSource {
  /** The page it came from, e.g. the maker's product page. */
  sourcePageUrl: string;
  /** That page's host, without "www." ("sony.com"), as the label says it. */
  sourceHost: string;
  /** The link it was fetched from. */
  imageUrl: string;
  caption: string | null;
}

/** "Product image · from sony.com": how a product image is labelled wherever it shows. */
export const productImageLabel = (host: string): string => `Product image · from ${host}`;

/** A link's host without "www.", lower case; null when it isn't a link. */
export function productImageHost(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

/**
 * Why a link can't be kept as a product image's (`what`: "The image link", "The source page"), or null: an https
 * address, no user name or password in it, at most 2000 characters. The website checks more before it fetches one.
 */
export function productImageUrlProblem(raw: unknown, what: string): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return `${what} is missing.`;
  const value = raw.trim();
  if (value.length > PRODUCT_IMAGE_RULES.urlMax) return `${what} is longer than ${PRODUCT_IMAGE_RULES.urlMax} characters.`;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return `${what} is not a link.`;
  }
  if (url.protocol !== 'https:') return `${what} must be an https:// link.`;
  if (url.username || url.password) return `${what} must not carry a user name or password.`;
  if (!url.hostname) return `${what} has no host.`;
  return null;
}

// ---------- the bytes ----------

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u32be = (b: Uint8Array, i: number) => b[i] * 0x1000000 + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);

/** A picture's kind by its first bytes (its magic numbers), never by what the server or the browser says it is. */
export function imageTypeOf(bytes: Uint8Array): ProductImageType | null {
  if (bytes.length >= 8 && PNG_SIGNATURE.every((v, i) => bytes[i] === v)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** Whether the bytes are SVG (text that opens with "<", an <svg> element in it): refused by name. */
export function looksLikeSvg(bytes: Uint8Array): boolean {
  const head = ascii(bytes, 0, Math.min(bytes.length, 1024))
    .replace(/^﻿|^\xEF\xBB\xBF/, '')
    .trimStart()
    .toLowerCase();
  return head.startsWith('<') && head.includes('<svg');
}

/** A JPEG's size, from its first frame header (SOF0 to SOF15, but DHT, JPG and DAC). */
function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  let i = 2;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) {
      i++; // fill byte
      continue;
    }
    // markers without a length
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // the end, or the image data, before any frame header
    const length = u16be(b, i + 2);
    if (length < 2) return null;
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      if (i + 8 >= b.length) return null;
      return { height: u16be(b, i + 5), width: u16be(b, i + 7) };
    }
    i += 2 + length;
  }
  return null;
}

/** A WebP's size: lossy (VP8), lossless (VP8L) or extended (VP8X). */
function webpSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 30) return null;
  const chunk = ascii(b, 12, 16);
  if (chunk === 'VP8 ') {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    if (b[20] !== 0x2f) return null;
    return { width: 1 + (((b[22] & 0x3f) << 8) | b[21]), height: 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)) };
  }
  if (chunk === 'VP8X') return { width: 1 + u24le(b, 24), height: 1 + u24le(b, 27) };
  return null;
}

/** A picture's kind and size, read from its bytes; null when it is no JPEG, PNG or WebP, or its size can't be read. */
export function imageInfo(bytes: Uint8Array): { type: ProductImageType; width: number; height: number } | null {
  const type = imageTypeOf(bytes);
  if (!type) return null;
  let size: { width: number; height: number } | null = null;
  if (type === 'image/png') size = bytes.length >= 24 && ascii(bytes, 12, 16) === 'IHDR' ? { width: u32be(bytes, 16), height: u32be(bytes, 20) } : null;
  else if (type === 'image/jpeg') size = jpegSize(bytes);
  else size = webpSize(bytes);
  return size && size.width > 0 && size.height > 0 ? { type, ...size } : null;
}

/** Why a picture's size isn't kept (each side 100 to 8000 pixels), or null. */
export function imageSizeProblem(width: number, height: number): string | null {
  const { minSide, maxSide } = PRODUCT_IMAGE_RULES;
  if (width < minSide || height < minSide) return `The image is ${width} × ${height} pixels: each side must be at least ${minSide}.`;
  if (width > maxSide || height > maxSide) return `The image is ${width} × ${height} pixels: each side must be at most ${maxSide}.`;
  return null;
}

/**
 * Why bytes can't be kept as a product image, or null: a JPEG, PNG or WebP by its magic numbers (SVG refused by name),
 * at most 5 MB, each side 100 to 8000 pixels. With its kind and size when it can.
 */
export function productImageProblem(bytes: Uint8Array): { problem: string } | { type: ProductImageType; width: number; height: number } {
  if (!bytes.length) return { problem: 'The image is empty.' };
  if (bytes.length > PRODUCT_IMAGE_RULES.maxBytes) return { problem: `The image is larger than ${PRODUCT_IMAGE_RULES.maxBytes / 1024 / 1024} MB.` };
  if (looksLikeSvg(bytes)) return { problem: 'The image is an SVG, which isn’t accepted (it can carry scripts): find a JPEG, PNG or WebP.' };
  const info = imageInfo(bytes);
  if (!info) return { problem: 'The link is not a JPEG, PNG or WebP image.' };
  const size = imageSizeProblem(info.width, info.height);
  return size ? { problem: size } : info;
}
