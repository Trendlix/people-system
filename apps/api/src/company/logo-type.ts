// Identifies an uploaded logo by its first bytes instead of trusting the browser's file type.
// SVG is deliberately not accepted: it can carry scripts.

export const LOGO_MAX_BYTES = 1024 * 1024;

export type LogoType = 'image/png' | 'image/jpeg' | 'image/webp';

export function detectLogoType(data: Buffer): LogoType | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}
