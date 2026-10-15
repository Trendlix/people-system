import type { Role } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import { NAV } from '../../../components/nav';
import { hasRole } from '../../../lib/roles';
import {
  canSeeOffers,
  countLabel,
  isFiltered,
  managesOffers,
  OFFER_STATUS_FILTERS,
  offerDocumentHref,
  offersHref,
  offersListPath,
  placeName,
  positionTitle,
  readOfferFilters,
  shownStatus,
} from './list';

const as = (...roles: Role[]) => ({ roles });

describe('who sees and changes offers', () => {
  it('shows them to HR and the CEO', () => {
    expect(canSeeOffers(as('employee', 'hr'))).toBe(true);
    expect(canSeeOffers(as('ceo'))).toBe(true);
    expect(canSeeOffers(as('finance'))).toBe(false);
    expect(canSeeOffers(as('admin'))).toBe(false);
    expect(canSeeOffers(as('super_admin'))).toBe(false);
    expect(canSeeOffers(as('manager', 'employee'))).toBe(false);
  });

  it('lets only HR draft, send and answer', () => {
    expect(managesOffers(as('hr'))).toBe(true);
    expect(managesOffers(as('ceo'))).toBe(false);
    expect(managesOffers(as('super_admin', 'ceo'))).toBe(false);
  });

  it('puts Offers in the sidebar for the same people', () => {
    const item = NAV.find((n) => n.href === '/offers');
    expect(item?.section).toBe('/offers');
    expect(hasRole(as('hr'), ...(item?.roles ?? []))).toBe(true);
    expect(hasRole(as('ceo'), ...(item?.roles ?? []))).toBe(true);
    expect(hasRole(as('employee', 'finance', 'admin'), ...(item?.roles ?? []))).toBe(false);
  });
});

describe('the list filters', () => {
  it('starts with the open offers and no search', () => {
    expect(readOfferFilters({})).toEqual({ q: '', status: 'open' });
    expect(isFiltered(readOfferFilters({}))).toBe(false);
  });

  it('reads a known status and a trimmed search, and drops anything else', () => {
    expect(readOfferFilters({ status: 'expired', q: '  omar  ' })).toEqual({ q: 'omar', status: 'expired' });
    expect(readOfferFilters({ status: 'nonsense' }).status).toBe('open');
    expect(readOfferFilters({ status: ['accepted', 'declined'] }).status).toBe('open');
    expect(readOfferFilters({ q: 'x'.repeat(150) }).q).toHaveLength(100);
  });

  it('offers Open (drafts and sent), each status, and All, in that order', () => {
    expect(OFFER_STATUS_FILTERS.map((s) => s.label)).toEqual(['Open', 'Drafts', 'Sent', 'Accepted', 'Declined', 'Withdrawn', 'Expired', 'All']);
    // the statuses GET /offers takes, besides All (no status)
    expect(OFFER_STATUS_FILTERS.map((s) => s.value).filter((v) => v !== 'all')).toEqual(['open', 'draft', 'sent', 'accepted', 'declined', 'withdrawn', 'expired']);
  });

  it('makes the page address without the defaults', () => {
    expect(offersHref({ q: '', status: 'open' })).toBe('/offers');
    expect(offersHref({ q: 'omar khaled', status: 'all' })).toBe('/offers?status=all&q=omar+khaled');
    expect(isFiltered({ q: '', status: 'accepted' })).toBe(true);
  });

  it('asks the API for a status, or for every status without one', () => {
    expect(offersListPath({ q: '', status: 'open' })).toBe('/offers?status=open');
    expect(offersListPath({ q: 'OFF-2026', status: 'declined' })).toBe('/offers?status=declined&q=OFF-2026');
    expect(offersListPath({ q: '', status: 'all' })).toBe('/offers');
    expect(offersListPath({ q: 'a&b', status: 'all' })).toBe('/offers?q=a%26b');
  });

  it('counts offers', () => {
    expect(countLabel(1)).toBe('1 offer');
    expect(countLabel(3)).toBe('3 offers');
  });
});

describe('an offer as shown', () => {
  it('is Expired once a sent offer is past its last day, whatever the API said', () => {
    expect(shownStatus('sent', '2026-10-14', '2026-10-15')).toBe('expired');
    expect(shownStatus('sent', '2026-10-15', '2026-10-15')).toBe('sent');
    expect(shownStatus('draft', '2026-10-01', '2026-10-15')).toBe('draft');
    expect(shownStatus('accepted', '2026-10-01', '2026-10-15')).toBe('accepted');
    expect(shownStatus('expired', '2026-10-20', '2026-10-15')).toBe('expired');
  });

  it('names the position by its job title, else the employment type', () => {
    expect(positionTitle({ jobTitle: { titleEn: 'Content Creator', titleAr: null }, employmentType: 'part_time' })).toBe('Content Creator');
    expect(positionTitle({ jobTitle: null, employmentType: 'internship' })).toBe('Internship');
  });

  it('names a team with its department', () => {
    const marketing = { id: 'd1', nameEn: 'Marketing', nameAr: null };
    expect(placeName({ id: 't1', nameEn: 'Content Team', nameAr: null, parent: marketing })).toBe('Marketing › Content Team');
    expect(placeName({ ...marketing, parent: null })).toBe('Marketing');
    expect(placeName(null)).toBeNull();
  });

  it('serves its document from the web server', () => {
    expect(offerDocumentHref('abc', 'pdf')).toBe('/offers/abc/document?format=pdf');
    expect(offerDocumentHref('abc', 'docx')).toBe('/offers/abc/document?format=docx');
  });
});
