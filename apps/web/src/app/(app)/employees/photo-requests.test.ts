import { describe, expect, it } from 'vitest';
import type { PhotoRequest } from '../../../lib/types';
import { ownPhotoHref, pendingPhoto, photoDecisionView, photoOutcome, photoRequestsPath, photosLabel, sentPhotoSrc } from './photo-requests';

// A new photo the employee sends HR (owner, 31 October 2026): what the pages say of it.

const request = (r: Partial<PhotoRequest>): PhotoRequest => ({
  id: 'p1',
  employee: { id: 'e1', employeeCode: 'TLX-001', fullNameEn: 'Mona Adel' },
  fileName: 'me.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 1000,
  note: null,
  status: 'pending',
  requestedBy: { email: 'mona@example.test' },
  requestedAt: '2026-10-30T09:00:00Z',
  decidedBy: null,
  decidedAt: null,
  decisionNote: null,
  photoId: null,
  ...r,
});

describe('photo requests', () => {
  it('has its addresses', () => {
    expect(ownPhotoHref('e1')).toBe('/employees/e1/photo');
    expect(sentPhotoSrc('p1')).toBe('/photo-request/p1');
    expect(photoRequestsPath('')).toBe('/photo-requests?status=all');
    expect(photoRequestsPath('pending')).toBe('/photo-requests?status=pending');
    expect([photosLabel(1), photosLabel(3)]).toEqual(['1 photo', '3 photos']);
  });

  it('finds the one waiting', () => {
    expect(pendingPhoto(undefined)).toBeUndefined();
    expect(pendingPhoto([request({ id: 'a', status: 'rejected' }), request({ id: 'b' })])?.id).toBe('b');
  });

  it('tells the employee what happened to each, with HR’s note', () => {
    expect(photoOutcome(request({}))).toBeNull();
    expect(photoOutcome(request({ status: 'approved', decidedAt: '2026-10-31T10:00:00Z' }))).toEqual({ title: 'Sent 30/10/2026 · approved on 31/10/2026: now your picture', note: null });
    expect(photoOutcome(request({ status: 'rejected', decidedAt: '2026-10-31T10:00:00Z', decisionNote: ' No sunglasses ' }))).toEqual({
      title: 'Sent 30/10/2026 · rejected on 31/10/2026: your photo stayed as it was',
      note: 'No sunglasses',
    });
    expect(photoOutcome(request({ status: 'cancelled', decidedAt: '2026-10-31T10:00:00Z', decisionNote: 'x' }))?.note).toBeNull();
  });

  it('tells HR who decided', () => {
    expect(photoDecisionView(request({}))).toBeNull();
    expect(photoDecisionView(request({ status: 'approved', decidedBy: { email: 'hr@example.test' } }))).toMatchObject({ title: 'Approved by hr@example.test', note: null });
    expect(photoDecisionView(request({ status: 'rejected', decisionNote: 'Blurry' }))).toMatchObject({ title: 'Rejected', note: 'Blurry' });
    expect(photoDecisionView(request({ status: 'cancelled' }))?.title).toBe('Cancelled by the employee');
  });
});
