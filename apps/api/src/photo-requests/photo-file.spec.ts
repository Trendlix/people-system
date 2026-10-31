import { BadRequestException } from '@nestjs/common';
import { PAPERWORK_MAX_BYTES } from '../paperwork/paperwork-file.js';
import { NO_PHOTO, NOT_A_PHOTO, PHOTO_TOO_LARGE, sentPhoto } from './photo-file.js';

// The photo an employee sends HR of themself (owner, 31 October 2026): a picture by its content, no larger than a paper of
// the employee file, its name made safe.

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 1, 2]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
const file = (buffer: Buffer, originalname = 'me.png', size = buffer.length) => ({ buffer, originalname, size });

const refusal = (run: () => unknown) => {
  try {
    run();
  } catch (err) {
    expect(err).toBeInstanceOf(BadRequestException);
    return (err as BadRequestException).message;
  }
  throw new Error('not refused');
};

describe('the photo sent to HR', () => {
  it('takes a JPEG, PNG or WebP image by its content, whatever it is called', () => {
    expect(sentPhoto(file(PNG, 'me.png'))).toEqual({ data: PNG, type: 'image/png', fileName: 'me.png' });
    expect(sentPhoto(file(JPEG, 'photo.png'))).toMatchObject({ type: 'image/jpeg', fileName: 'photo.jpg' });
    expect(sentPhoto(file(WEBP, 'IMG_1.webp'))).toMatchObject({ type: 'image/webp', fileName: 'IMG_1.webp' });
    // no folders or hidden marks in the name
    expect(sentPhoto(file(PNG, '../../etc/me‮.png')).fileName).toBe('me.png');
  });

  it('refuses nothing, a PDF or anything else, and a file larger than a paper', () => {
    expect(refusal(() => sentPhoto(undefined))).toBe(NO_PHOTO);
    expect(refusal(() => sentPhoto(file(Buffer.alloc(0))))).toBe(NO_PHOTO);
    expect(refusal(() => sentPhoto(file(Buffer.from('%PDF-1.4\n'), 'me.pdf')))).toBe(NOT_A_PHOTO);
    expect(refusal(() => sentPhoto(file(Buffer.from('GIF89a......'), 'me.gif')))).toBe(NOT_A_PHOTO);
    expect(refusal(() => sentPhoto(file(PNG, 'me.png', PAPERWORK_MAX_BYTES + 1)))).toBe(PHOTO_TOO_LARGE);
    expect(PHOTO_TOO_LARGE).toBe('The photo must be 10 MB or smaller.');
  });
});
