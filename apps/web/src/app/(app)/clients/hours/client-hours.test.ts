import { describe, expect, it } from 'vitest';
import {
  accountHref,
  apiClientHoursPath,
  apiExcelPath,
  CLIENT_HOURS_PATH,
  clientCount,
  clientHoursHref,
  clientsText,
  excelHref,
  hoursFigure,
  peopleText,
  readMonth,
} from './client-hours';

// Clients → Client Hours (owner, 4 November 2026: "Full salary, hours tracked"; the client reports).

const TODAY = '2026-11-04';
const ID = '0b8f0c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e';

describe('the month asked for', () => {
  it('reads a month from the address, this month without a valid one', () => {
    expect(readMonth({ month: '2026-10' }, TODAY)).toBe('2026-10');
    expect(readMonth({ month: ['2026-09', '2026-08'] }, TODAY)).toBe('2026-09');
    expect(readMonth({}, TODAY)).toBe('2026-11');
    for (const bad of ['2026-13', '2026-1', '10/2026', '', 'x']) expect(readMonth({ month: bad }, TODAY)).toBe('2026-11');
  });

  it('writes the page’s address, leaving this month out', () => {
    expect(CLIENT_HOURS_PATH).toBe('/clients/hours');
    expect(clientHoursHref('2026-11', '2026-11')).toBe('/clients/hours');
    expect(clientHoursHref('2026-10', '2026-11')).toBe('/clients/hours?month=2026-10');
  });
});

describe('the report and its workbook', () => {
  it('asks the API for the month, always written out', () => {
    expect(apiClientHoursPath('2026-11')).toBe('/reports/client-hours?month=2026-11');
    expect(excelHref('2026-10')).toBe('/clients/hours/excel?month=2026-10');
  });

  it('reads the download’s month as the page reads it', () => {
    expect(apiExcelPath(new URLSearchParams('month=2026-10'), TODAY)).toBe('/reports/client-hours.xlsx?month=2026-10');
    expect(apiExcelPath(new URLSearchParams('month=nope'), TODAY)).toBe('/reports/client-hours.xlsx?month=2026-11');
    expect(apiExcelPath(new URLSearchParams(), TODAY)).toBe('/reports/client-hours.xlsx?month=2026-11');
  });
});

describe('the table', () => {
  it('links a client to its account, never "No client"', () => {
    expect(accountHref({ id: ID, name: 'Acme', code: 'AC-1' })).toBe(`/clients/accounts?account=${ID}`);
    expect(accountHref({ id: 'not-an-id', name: 'Acme', code: null })).toBeNull();
    expect(accountHref(null)).toBeNull();
  });

  it('writes hours as bare figures and counts people and clients', () => {
    expect(hoursFigure(38.5)).toBe('38.5');
    expect(hoursFigure(7.75)).toBe('7.75');
    expect(hoursFigure(0)).toBe('0');
    expect(hoursFigure(1234.5)).toBe('1,234.5');
    expect(hoursFigure(0.1 + 0.2)).toBe('0.3');
    expect(peopleText(1)).toBe('1 person');
    expect(peopleText(3)).toBe('3 people');
    expect(clientsText(1)).toBe('1 client');
    expect(clientsText(0)).toBe('0 clients');
    expect(clientCount([{ client: { id: ID, name: 'Acme', code: null } }, { client: null }])).toBe(1);
  });
});
