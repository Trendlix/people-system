import { describe, expect, it } from 'vitest';
import { apiMessagesPath, daysTotals, isFiltered, MESSAGE_TYPES, messagesHref, NO_MESSAGE_FILTERS, pagesOf, rangeText, readMessageFilters } from './messages';

// WhatsApp Messages (owner, 24 October 2026; the brief: "a WhatsApp Messages log (Super Admin and HR) with filters
// (status, type, date) … per-day counts (cost awareness)"): the filters in the address and the page's words.

describe('the filters in the address', () => {
  it('read the status, the type and the days (typed or as links write them), and the page', () => {
    const { filters, problems } = readMessageFilters({ status: 'failed', template: 'approval_waiting', from: '01/10/2026', to: '2026-10-24', page: '3' });
    expect(problems).toEqual([]);
    expect(filters).toEqual({ status: 'failed', template: 'approval_waiting', from: '2026-10-01', to: '2026-10-24', page: 3 });
  });

  it('leave out what isn’t one, saying so', () => {
    const { filters, problems } = readMessageFilters({ status: 'lost', template: 'marketing', from: '31/02/2026', page: '-2' });
    expect(filters).toEqual(NO_MESSAGE_FILTERS);
    expect(problems).toEqual(['Enter the first day as DD/MM/YYYY, e.g. 01/10/2026.', 'Choose the status from the list.', 'Choose the type from the list.']);
    expect(readMessageFilters({ from: '2026-10-24', to: '2026-10-01' }).problems).toEqual(['The first day is after the last.']);
  });

  it('take the STOP answers as a type', () => {
    expect(readMessageFilters({ template: 'stop_confirmation' }).filters.template).toBe('stop_confirmation');
    expect(MESSAGE_TYPES.at(-1)).toEqual({ value: 'stop_confirmation', label: 'STOP answered' });
  });

  it('make the page’s links and the API’s query', () => {
    const f = { ...NO_MESSAGE_FILTERS, status: 'read' as const, from: '2026-10-01', page: 2 };
    expect(messagesHref(f)).toBe('/whatsapp-messages?status=read&from=2026-10-01');
    expect(messagesHref(f, 2)).toBe('/whatsapp-messages?status=read&from=2026-10-01&page=2');
    expect(apiMessagesPath(f)).toBe('/whatsapp/messages?status=read&from=2026-10-01&page=2');
    expect(apiMessagesPath(NO_MESSAGE_FILTERS)).toBe('/whatsapp/messages');
    expect(isFiltered(f)).toBe(true);
    expect(isFiltered(NO_MESSAGE_FILTERS)).toBe(false);
  });
});

describe('the page’s words', () => {
  it('count the pages and say the range', () => {
    expect(pagesOf({ total: 101, pageSize: 50 })).toBe(3);
    expect(pagesOf({ total: 0, pageSize: 50 })).toBe(1);
    expect(rangeText({ total: 230, page: 2, pageSize: 50 })).toBe('51–100 of 230 messages');
    expect(rangeText({ total: 1, page: 1, pageSize: 50 })).toBe('1–1 of 1 message');
    expect(rangeText({ total: 0, page: 1, pageSize: 50 })).toBe('No messages');
  });

  it('add up the days', () => {
    expect(
      daysTotals([
        { day: '2026-10-24', total: 5, sent: 1, delivered: 2, read: 1, failed: 1, waiting: 0 },
        { day: '2026-10-23', total: 3, sent: 0, delivered: 2, read: 0, failed: 0, waiting: 1 },
      ]),
    ).toEqual({ total: 8, sent: 1, delivered: 4, read: 1, failed: 1, waiting: 1 });
  });
});
