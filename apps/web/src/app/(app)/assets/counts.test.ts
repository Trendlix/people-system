import { describe, expect, it } from 'vitest';
import type { AssetCountSheetItem, AssetDashboardView } from '@trendlix/shared';
import { APP_ASSET_PATHS, ASSET_PATHS, ASSET_STEP5_API } from '../../../lib/asset-paths';
import {
  attentionChips,
  countFiguresText,
  foundCodes,
  readCountScope,
  readLabelPrint,
  readLabelQuery,
  saveCountQuestion,
  sheetsText,
  tickFromText,
  tickText,
  untickedCount,
} from './counts';
import { labelSheetsDocument, sheetMarkup } from './label';

// Assets step 5 on the pages (owner, 22 October 2026: "Assets step 5 (stock counts, label sheets, the Assets dashboard,
// exports) … work on this").

const ROOM = '3f1c2a9e-5b7d-4e1f-9a2b-6c8d0e4f1a2b';

const item = (code: string, status: AssetCountSheetItem['status'] = 'available'): Pick<AssetCountSheetItem, 'code' | 'name' | 'status'> => ({ code, name: `Camera ${code.slice(-1)}`, status });
const SHEET = [item('PK-CAM-0001'), item('PK-CAM-0002', 'custody'), item('PK-CAM-0003', 'lost'), item('CS-TAP-0001')];

describe('a count\'s address', () => {
  it('reads a group, a room or a kit', () => {
    expect(readCountScope({ kind: 'group', group: 'kit' })).toEqual({ kind: 'group', group: 'kit' });
    expect(readCountScope({ kind: 'room', roomId: ROOM })).toEqual({ kind: 'room', roomId: ROOM });
    expect(readCountScope({ kind: 'kit', kitId: ROOM })).toEqual({ kind: 'kit', kitId: ROOM });
  });

  it('reads nothing that names none', () => {
    expect(readCountScope({})).toBeNull();
    expect(readCountScope({ kind: 'group', group: 'cars' })).toBeNull();
    expect(readCountScope({ kind: 'room' })).toBeNull();
    expect(readCountScope({ kind: 'room', roomId: 'not-an-id' })).toBeNull();
    expect(readCountScope({ kind: 'shelf', roomId: ROOM })).toBeNull();
  });

  it('is written back the same way, the API\'s and the pages\'', () => {
    expect(ASSET_PATHS.countNew({ kind: 'group', group: 'kit' })).toBe('/assets/counts/new?kind=group&group=kit');
    expect(ASSET_PATHS.countNew({ kind: 'room', roomId: ROOM, group: 'kit' })).toBe(`/assets/counts/new?kind=room&roomId=${ROOM}`);
    expect(APP_ASSET_PATHS.countNew({ kind: 'kit', kitId: ROOM })).toBe(`/app/assets/counts/new?kind=kit&kitId=${ROOM}`);
    expect(ASSET_STEP5_API.sheet({ kind: 'group', group: 'it' })).toBe('/assets/counts/sheet?kind=group&group=it');
    expect(ASSET_STEP5_API.markLost('c1', 'PK-CAM-0001')).toBe('/assets/counts/c1/lines/PK-CAM-0001/lost');
    expect(ASSET_STEP5_API.counts(1)).toBe('/assets/counts');
    expect(ASSET_STEP5_API.counts(3)).toBe('/assets/counts?page=3');
    expect(ASSET_PATHS.labelsPrint(['PK-CAM-0001', 'IT-LAP-0002'], 5)).toBe('/assets/labels/print?codes=PK-CAM-0001%2CIT-LAP-0002&start=5');
    expect(ASSET_PATHS.exportFile('register')).toBe('/assets/exports/register');
  });
});

describe('ticking on a count\'s sheet', () => {
  it('ticks a code typed or scanned, in any case, or from the label\'s address', () => {
    const one = tickFromText('pk-cam-0001', SHEET, new Set());
    expect(one.outcome).toEqual({ kind: 'ticked', code: 'PK-CAM-0001', name: 'Camera 1' });
    expect([...one.ticked]).toEqual(['PK-CAM-0001']);
    const two = tickFromText('https://people.trendlix.com/assets/PK-CAM-0003', SHEET, one.ticked);
    expect([...two.ticked].sort()).toEqual(['PK-CAM-0001', 'PK-CAM-0003']);
  });

  it('says when it is ticked already, in custody, elsewhere or not a code, and changes nothing', () => {
    const ticked = new Set(['PK-CAM-0001']);
    expect(tickFromText('PK-CAM-0001', SHEET, ticked).outcome.kind).toBe('already');
    const out = tickFromText('PK-CAM-0002', SHEET, ticked);
    expect(out.outcome.kind).toBe('out');
    expect([...out.ticked]).toEqual(['PK-CAM-0001']);
    expect(tickFromText('PK-CAM-0099', SHEET, ticked).outcome).toEqual({ kind: 'elsewhere', code: 'PK-CAM-0099' });
    expect(tickFromText('hello', SHEET, ticked).outcome).toEqual({ kind: 'unread' });
  });

  it('says what happened in words', () => {
    expect(tickText({ kind: 'ticked', code: 'PK-CAM-0001', name: 'Camera 1' }, 'Studio A')).toBe('Ticked PK-CAM-0001 · Camera 1.');
    expect(tickText({ kind: 'out', code: 'PK-CAM-0002', name: 'Camera 2' }, 'Studio A')).toBe('PK-CAM-0002 · Camera 2 is in custody: it counts as out.');
    expect(tickText({ kind: 'elsewhere', code: 'PK-CAM-0099' }, 'Studio A')).toBe('PK-CAM-0099 isn’t counted with Studio A. Count it where it is kept.');
    expect(tickText({ kind: 'unread' }, 'Studio A')).toBe('That isn’t an asset’s code. Type it as on the label, e.g. PK-CAM-0003.');
  });

  it('sends only what is ticked and on the sheet, never one in custody, and asks before saving with some unticked', () => {
    const ticked = new Set(['PK-CAM-0003', 'PK-CAM-0001', 'PK-CAM-0002', 'XX']);
    expect(foundCodes(SHEET, ticked)).toEqual(['PK-CAM-0001', 'PK-CAM-0003']);
    expect(untickedCount(SHEET, ticked)).toBe(1);
    expect(saveCountQuestion(1)).toBe('1 asset isn’t ticked: it will be counted missing. Save the count?');
    expect(saveCountQuestion(3)).toBe('3 assets aren’t ticked: they will be counted missing. Save the count?');
    expect(saveCountQuestion(0)).toBeNull();
  });

  it('says a count\'s figures in a line', () => {
    expect(countFiguresText({ expected: 6, found: 3, missing: 1, out: 2, lostMarked: 0 })).toBe('6 expected · 3 found · 1 missing · 2 out');
    expect(countFiguresText({ expected: 6, found: 3, missing: 1, out: 2, lostMarked: 1 })).toBe('6 expected · 3 found · 1 missing · 2 out · 1 marked lost');
  });
});

describe('the dashboard\'s chips', () => {
  const attention: AssetDashboardView['attention'] = { overdueReturns: 2, lost: 1, lowStock: 0, countsDue: 3, unsigned: 4, repair: 0, clearance: 1 };

  it('lists them in the spec\'s order, each opening its list, none where there is nothing', () => {
    const chips = attentionChips({ attention });
    expect(chips.map((c) => [c.label, c.count, c.href])).toEqual([
      ['Overdue returns', 2, '/assets/custody?filter=overdue'],
      ['Lost', 1, '/assets?status=lost'],
      ['Low stock', 0, null],
      ['Counts due', 3, '/assets/counts'],
      ['Signed copy not attached', 4, '/assets/custody?filter=unsigned'],
      ['Under repair', 0, null],
      ['Employees in clearance', 1, '/assets/holders'],
    ]);
  });

  it('leaves out Employees in clearance while the system has no offboarding', () => {
    expect(attentionChips({ attention: { ...attention, clearance: null } }).map((c) => c.key)).not.toContain('clearance');
  });
});

describe('the label sheets\' choices', () => {
  it('shows what isn\'t labelled yet unless asked for all, with a group, room, kit and search read safely', () => {
    expect(readLabelQuery({})).toEqual({ unlabelled: true, group: null, roomId: null, kitId: null, q: null });
    expect(readLabelQuery({ show: 'all', group: 'kit', roomId: ROOM, kitId: 'nope', q: ' cam ' })).toEqual({ unlabelled: false, group: 'kit', roomId: ROOM, kitId: null, q: 'cam' });
    expect(readLabelQuery({ group: 'cars' }).group).toBeNull();
  });

  it('reads the codes to print (each once, codes only, in order) and the label to start at', () => {
    expect(readLabelPrint({ codes: 'PK-CAM-0002,pk-cam-0001,PK-CAM-0002,junk', start: '4' })).toEqual({ codes: ['PK-CAM-0002', 'PK-CAM-0001'], start: 4, startProblem: null });
    expect(readLabelPrint({ codes: ['PK-CAM-0001', 'IT-LAP-0003'] }).codes).toEqual(['PK-CAM-0001', 'IT-LAP-0003']);
    expect(readLabelPrint({ codes: 'PK-CAM-0001', start: '30' })).toEqual({ codes: ['PK-CAM-0001'], start: 1, startProblem: 'Choose the label to start at: from 1 to 24.' });
    expect(readLabelPrint({}).codes).toEqual([]);
  });

  it('says how many labels on how many sheets', () => {
    expect(sheetsText(1)).toBe('1 label on 1 sheet');
    expect(sheetsText(24)).toBe('24 labels on 1 sheet');
    expect(sheetsText(5, 22)).toBe('5 labels on 2 sheets');
    expect(sheetsText(30)).toBe('30 labels on 2 sheets');
  });
});

describe('the label sheets', () => {
  const label = (code: string) => ({ code, name: `Camera <${code}>`, company: 'TrendLIX', qrSvg: '<svg></svg>' });

  it('lays a sheet out as 24 places, the empty ones blank', () => {
    const html = sheetMarkup([label('PK-CAM-0001'), null, ...Array<null>(22).fill(null)]);
    expect(html.match(/class="place"/g)).toHaveLength(24);
    expect(html.match(/class="asset-label"/g)).toHaveLength(1);
    expect(html).toContain('Camera &lt;PK-CAM-0001&gt;');
  });

  it('prints A4 pages with no margin, one sheet a page, from the label chosen', () => {
    const doc = labelSheetsDocument([label('PK-CAM-0001'), label('PK-CAM-0002')], 24);
    expect(doc).toContain('@page{size:A4;margin:0}');
    expect(doc.match(/class="label-sheet"/g)).toHaveLength(2);
    expect(doc.match(/class="asset-label"/g)).toHaveLength(2);
    expect(doc).toContain('width:210mm;height:297mm;padding:28.5mm 10.5mm');
    expect(doc).toContain('grid-template-columns:repeat(3,63mm)');
  });
});
