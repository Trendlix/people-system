import { TEMPLATE_TAGS } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import type { TemplateLine } from '../../../lib/types';
import {
  addAt,
  addEdit,
  afterLabel,
  allSuggestions,
  applyEdits,
  buildRequest,
  changeTag,
  clashWith,
  countEdits,
  describeEdit,
  fillBlank,
  fromSuggestion,
  hasFields,
  insertionText,
  lineDirection,
  lineName,
  lineSegments,
  lineWords,
  MAX_EDITS,
  offsetAfter,
  openSuggestionCount,
  openSuggestions,
  overlaps,
  pickerGroups,
  readRequest,
  removeTag,
  saveProblem,
  summaryText,
  undoEdit,
  type PendingEdit,
} from './mapping';

/** A line, with its tags and blanks found in its text (as the API does), unless given. */
function line(text: string, extra: Partial<TemplateLine> = {}, id = 'b1'): TemplateLine {
  const tags = [...text.matchAll(/\{\{([a-z_]+)\}\}/gi)].map((m) => ({
    tag: m[1],
    from: m.index,
    to: m.index + m[0].length,
    known: TEMPLATE_TAGS.some((t) => t.tag === m[1]),
  }));
  const blanks = [...text.matchAll(/[._]{4,}/g)].map((m) => ({ from: m.index, to: m.index + m[0].length }));
  return { id, part: 'body', partLabel: 'Body', index: 0, text, tags, blanks, suggestions: [], ...extra };
}

/** The edit a builder made (fails the test on an error). */
function edit(built: { edit: PendingEdit } | { error: string }): PendingEdit {
  if ('error' in built) throw new Error(built.error);
  return built.edit;
}

describe('overlaps', () => {
  it('finds ranges that share a character, but not ranges that only touch', () => {
    expect(overlaps({ from: 0, to: 5 }, { from: 4, to: 8 })).toBe(true);
    expect(overlaps({ from: 0, to: 5 }, { from: 5, to: 8 })).toBe(false);
    expect(overlaps({ from: 2, to: 3 }, { from: 0, to: 8 })).toBe(true);
  });

  it('finds a field put in strictly inside a range, or two put in at the same point', () => {
    expect(overlaps({ from: 3, to: 3 }, { from: 0, to: 5 })).toBe(true);
    expect(overlaps({ from: 0, to: 5 }, { from: 5, to: 5 })).toBe(false);
    expect(overlaps({ from: 0, to: 0 }, { from: 0, to: 5 })).toBe(false);
    expect(overlaps({ from: 4, to: 4 }, { from: 4, to: 4 })).toBe(true);
    expect(overlaps({ from: 4, to: 4 }, { from: 5, to: 5 })).toBe(false);
  });
});

describe('insertionText', () => {
  it('puts a space before the tag after a word or punctuation, but not after a space, at the start or after a bracket', () => {
    expect(insertionText('Name:', 5, 'full_name_en')).toBe(' {{full_name_en}}');
    expect(insertionText('Name: ', 6, 'full_name_en')).toBe('{{full_name_en}}');
    expect(insertionText('starts here', 0, 'date')).toBe('{{date}} ');
    expect(insertionText('(see)', 1, 'date')).toBe('{{date}} ');
  });

  it('puts a space after the tag when a letter or digit follows, in Arabic too', () => {
    expect(insertionText('Mr Smith', 2, 'full_name_en')).toBe(' {{full_name_en}}');
    expect(insertionText('السيد محمد', 5, 'full_name_ar')).toBe(' {{full_name_ar}}');
    expect(insertionText('السيدمحمد', 5, 'full_name_ar')).toBe(' {{full_name_ar}} ');
    expect(insertionText('Date:.', 5, 'date')).toBe(' {{date}}');
  });
});

describe('the changes', () => {
  const l = line('Name: {{nam}} ID: .......... Date {{date}}');

  it('puts a field in at a point, at the end of the line or after a text', () => {
    expect(edit(addAt(l, l.text.length, 'national_id', 'e1'))).toEqual({
      key: 'e1',
      line: 'b1',
      from: l.text.length,
      to: l.text.length,
      text: ' {{national_id}}',
      kind: 'add',
      tag: 'national_id',
      was: null,
      replaced: '',
    });
  });

  it('refuses a field not in the tag list, a place outside the line, or the middle of a tag', () => {
    expect(addAt(l, 0, 'no_such_tag', 'e1')).toEqual({ error: '{{no_such_tag}} is not in the tag list: choose a field from the list.' });
    expect('error' in addAt(l, l.text.length + 1, 'date', 'e1')).toBe(true);
    expect('error' in addAt(l, -1, 'date', 'e1')).toBe(true);
    expect(addAt(l, 8, 'date', 'e1')).toEqual({ error: 'A field can’t go in the middle of a tag: choose another place.' });
  });

  it('fills a blank with {{tag}}, keeping what it replaces', () => {
    const e = edit(fillBlank(l, 0, 'national_id', 'e2'));
    expect(e).toMatchObject({ from: 18, to: 28, text: '{{national_id}}', kind: 'fill', replaced: '..........' });
    expect('error' in fillBlank(l, 1, 'national_id', 'e2')).toBe(true);
  });

  it('changes a tag to another field, but not to itself', () => {
    expect(edit(changeTag(l, 0, 'full_name_en', 'e3'))).toMatchObject({ from: 6, to: 13, text: '{{full_name_en}}', kind: 'change', tag: 'full_name_en', was: 'nam' });
    expect(changeTag(l, 1, 'date', 'e3')).toEqual({ error: 'It is {{date}} already: choose another field.' });
  });

  it('removes a tag: nothing in its place', () => {
    expect(edit(removeTag(l, 1, 'e4'))).toMatchObject({ from: 34, to: 42, text: '', kind: 'remove', tag: null, was: 'date', replaced: '{{date}}' });
  });
});

describe('addEdit and undoEdit', () => {
  const l = line('Name: {{nam}} ID: ..........');

  it('adds a change, and a second change of the same tag or blank takes the place of the first', () => {
    const change = edit(changeTag(l, 0, 'full_name_en', 'e1'));
    const fill = edit(fillBlank(l, 0, 'national_id', 'e2'));
    let r = addEdit([], change);
    if (!('edits' in r)) throw new Error(r.error);
    r = addEdit(r.edits, fill);
    if (!('edits' in r)) throw new Error(r.error);
    const removal = edit(removeTag(l, 0, 'e3'));
    const again = addEdit(r.edits, removal);
    if (!('edits' in again)) throw new Error(again.error);
    expect(again.edits.map((e) => e.key)).toEqual(['e3', 'e2']);
  });

  it('refuses a change where another one goes, saying which', () => {
    const fill = edit(fillBlank(l, 0, 'national_id', 'e1'));
    const inside = edit(addAt(l, 20, 'date', 'e2'));
    expect(addEdit([fill], inside)).toEqual({ error: 'This place already has a change ({{national_id}} put in a blank): undo it first, or choose another place.' });
    const end1 = edit(addAt(l, l.text.length, 'date', 'e3'));
    const end2 = edit(addAt(l, l.text.length, 'start_date', 'e4'));
    expect('error' in addEdit([end1], end2)).toBe(true);
  });

  it('keeps changes of other lines apart', () => {
    const other = line('Name: {{nam}} ID: ..........', {}, 'b2');
    const a = edit(removeTag(l, 0, 'e1'));
    const b = edit(removeTag(other, 0, 'e2'));
    expect(clashWith(b, [a])).toBeUndefined();
  });

  it('undoes one change by its key', () => {
    const a = edit(removeTag(l, 0, 'e1'));
    const b = edit(fillBlank(l, 0, 'date', 'e2'));
    expect(undoEdit([a, b], 'e1')).toEqual([b]);
  });
});

describe('applyEdits', () => {
  it('gives the line with every change made, in the order they fall', () => {
    const l = line('Name: {{nam}} ID: .......... Date {{date}}');
    const edits = [
      edit(addAt(l, l.text.length, 'national_id', 'e1')),
      edit(changeTag(l, 0, 'full_name_en', 'e2')),
      edit(fillBlank(l, 0, 'national_id', 'e3')),
      edit(removeTag(l, 1, 'e4')),
      edit(addAt(l, 0, 'employee_code', 'e5')),
    ];
    expect(applyEdits(l, edits)).toBe('{{employee_code}} Name: {{full_name_en}} ID: {{national_id}} Date  {{national_id}}');
  });

  it('puts a field in just after a tag that is changed', () => {
    const l = line('{{nam}}');
    const edits = [edit(addAt(l, 7, 'date', 'e1')), edit(changeTag(l, 0, 'full_name_ar', 'e2'))];
    expect(applyEdits(l, edits)).toBe('{{full_name_ar}} {{date}}');
  });

  it('leaves the line as it is without changes of its own', () => {
    const l = line('Name: {{nam}}');
    const other = line('x', {}, 'b2');
    expect(applyEdits(l, [edit(addAt(other, 1, 'date', 'e1'))])).toBe('Name: {{nam}}');
  });
});

describe('lineSegments', () => {
  it('splits a line into text, tags and blanks', () => {
    const l = line('Name: {{nam}} ID: ....');
    expect(lineSegments(l, []).map((s) => [s.kind, s.from, s.to])).toEqual([
      ['text', 0, 6],
      ['tag', 6, 13],
      ['text', 13, 18],
      ['blank', 18, 22],
    ]);
    const tag = lineSegments(l, [])[1];
    expect(tag).toMatchObject({ kind: 'tag', index: 0, tag: 'nam', known: false, text: '{{nam}}' });
  });

  it('shows each change in its place, in place of what it replaces', () => {
    const l = line('Name: {{nam}} ID: ....');
    const edits = [edit(fillBlank(l, 0, 'national_id', 'e1')), edit(removeTag(l, 0, 'e2')), edit(addAt(l, 5, 'full_name_en', 'e3'))];
    expect(lineSegments(l, edits).map((s) => (s.kind === 'edit' ? `edit:${s.edit.key}` : `${s.kind}:${s.text}`))).toEqual([
      'text:Name:',
      'edit:e3',
      'text: ',
      'edit:e2',
      'text: ID: ',
      'edit:e1',
    ]);
  });

  it('keeps what is left of a blank partly filled by a suggestion', () => {
    const l = line('ID: ........', { suggestions: [{ tag: 'national_id', from: 4, to: 8, label: 'National ID number', text: '{{national_id}}' }] });
    const segments = lineSegments(l, [edit(fromSuggestion(l, 0, 'e1'))]);
    expect(segments.map((s) => [s.kind, s.from, s.to])).toEqual([
      ['text', 0, 4],
      ['edit', 4, 8],
      ['blank', 8, 12],
    ]);
  });

  it('shows an empty line as nothing, and a field put in it alone', () => {
    const l = line('');
    expect(lineSegments(l, [])).toEqual([]);
    expect(lineSegments(l, [edit(addAt(l, 0, 'date', 'e1'))]).map((s) => s.kind)).toEqual(['edit']);
  });
});

describe('suggestions', () => {
  const l = line('National ID: Date ........', {
    suggestions: [
      { tag: 'national_id', from: 12, to: 12, label: 'National ID number', text: ' {{national_id}}' },
      { tag: 'date', from: 18, to: 26, label: 'Date', text: '{{date}}' },
      { tag: 'not_a_tag', from: 0, to: 0, label: 'Nothing', text: ' {{not_a_tag}}' },
    ],
  });

  it('sends the text the API gives, e.g. without a space where the place is past one already', () => {
    const spaced = line('الرقم القومي: ', { suggestions: [{ tag: 'national_id', from: 14, to: 14, label: 'National ID number', text: '{{national_id}}' }] });
    expect(edit(fromSuggestion(spaced, 0, 'e1'))).toMatchObject({ from: 14, to: 14, text: '{{national_id}}', kind: 'add' });
    expect(applyEdits(spaced, [edit(fromSuggestion(spaced, 0, 'e1'))])).toBe('الرقم القومي: {{national_id}}');
  });

  it('makes the text itself when the API gives none, or one that isn’t the tag', () => {
    const bare = line('ID:', { suggestions: [{ tag: 'national_id', from: 3, to: 3, label: '' } as TemplateLine['suggestions'][number]] });
    expect(edit(fromSuggestion(bare, 0, 'e1')).text).toBe(' {{national_id}}');
    const wrong = line('ID: ....', { suggestions: [{ tag: 'national_id', from: 4, to: 8, label: '', text: 'some words' }] });
    expect(edit(fromSuggestion(wrong, 0, 'e1')).text).toBe('{{national_id}}');
    const other = line('ID: ....', { suggestions: [{ tag: 'national_id', from: 4, to: 8, label: '', text: '{{date}}' }] });
    expect(edit(fromSuggestion(other, 0, 'e1')).text).toBe('{{national_id}}');
  });

  it('puts " {{tag}}" in at a point, or {{tag}} in place of a blank, as the API says', () => {
    expect(edit(fromSuggestion(l, 0, 'e1'))).toMatchObject({ from: 12, to: 12, text: ' {{national_id}}', kind: 'add', suggestion: 'b1#0' });
    expect(edit(fromSuggestion(l, 1, 'e2'))).toMatchObject({ from: 18, to: 26, text: '{{date}}', kind: 'fill', replaced: '........', suggestion: 'b1#1' });
  });

  it('offers those not dismissed, of a known field, and not where a change already goes', () => {
    expect(openSuggestions(l, [], new Set()).map((s) => s.tag)).toEqual(['national_id', 'date']);
    expect(openSuggestions(l, [], new Set(['b1#0'])).map((s) => s.tag)).toEqual(['date']);
    const filled = edit(fillBlank(l, 0, 'start_date', 'e1'));
    expect(openSuggestions(l, [filled], new Set()).map((s) => s.tag)).toEqual(['national_id']);
    expect(openSuggestionCount([l, line('nothing', {}, 'b2')], [], new Set())).toBe(2);
  });

  it('adds all of them at once, leaving out one that falls where another goes', () => {
    const twice = line('ID:', {
      id: 'b2',
      suggestions: [
        { tag: 'national_id', from: 3, to: 3, label: 'National ID number', text: ' {{national_id}}' },
        { tag: 'id_printed_no', from: 3, to: 3, label: 'Printed number', text: ' {{id_printed_no}}' },
      ],
    });
    const r = allSuggestions([l, twice], [], new Set(), (n) => `s${n}`);
    expect(r.added).toBe(3);
    expect(r.skipped).toBe(1);
    expect(r.edits.map((e) => [e.line, e.tag, e.key])).toEqual([
      ['b1', 'national_id', 's0'],
      ['b1', 'date', 's1'],
      ['b2', 'national_id', 's2'],
    ]);
  });

  it('keeps the changes already made', () => {
    const made = edit(addAt(l, 0, 'employee_code', 'e1'));
    const r = allSuggestions([l], [made], new Set(['b1#1']), (n) => `s${n}`);
    expect(r.edits.map((e) => e.key)).toEqual(['e1', 's0']);
  });
});

describe('hasFields', () => {
  it('is true for a line with a tag, a blank or a suggestion', () => {
    expect(hasFields(line('Name: {{nam}}'))).toBe(true);
    expect(hasFields(line('ID: ....'))).toBe(true);
    expect(hasFields(line('ID:', { suggestions: [{ tag: 'national_id', from: 3, to: 3, label: '', text: ' {{national_id}}' }] }))).toBe(true);
    expect(hasFields(line('Just words'))).toBe(false);
  });
});

describe('lineName', () => {
  it('numbers a line within its part, naming the part when the file has several, as the API does', () => {
    expect(lineName({ index: 12, partLabel: 'Body' }, true)).toBe('Line 13 of the body');
    expect(lineName({ index: 0, partLabel: 'Footer' }, true)).toBe('Line 1 of the footer');
    expect(lineName({ index: 12, partLabel: 'Body' }, false)).toBe('Line 13');
  });
});

describe('lineDirection', () => {
  it('reads a line with more Arabic letters than Latin ones right to left', () => {
    expect(lineDirection('الاسم: {{full_name_ar}}', 'en')).toBe('rtl');
    expect(lineDirection('Name: {{full_name_en}}', 'ar')).toBe('ltr');
    expect(lineDirection('Name الاسم الكامل', 'bilingual')).toBe('rtl');
  });

  it('reads a line with neither as the document does', () => {
    expect(lineDirection('1 / 2 ....', 'ar')).toBe('rtl');
    expect(lineDirection('1 / 2 ....', 'en')).toBe('ltr');
    expect(lineDirection('{{date}}', 'bilingual')).toBe('ltr');
  });
});

describe('lineWords', () => {
  it('gives each word with the offset after it, numbering words that come again', () => {
    expect(lineWords(line('the name and the date'))).toEqual([
      { label: 'the', offset: 3 },
      { label: 'name', offset: 8 },
      { label: 'and', offset: 12 },
      { label: 'the (2)', offset: 16 },
      { label: 'date', offset: 21 },
    ]);
  });

  it('leaves out a place in the middle of a tag', () => {
    expect(lineWords(line('Name: {{full name}} end')).map((w) => w.label)).toEqual(['Name:', '{{full', 'name}}', 'end']);
    const l = { text: 'Name: {{full name}} end', tags: [{ tag: 'full name', from: 6, to: 19, known: false }] };
    expect(lineWords(l).map((w) => w.label)).toEqual(['Name:', 'name}}', 'end']);
  });
});

describe('afterLabel', () => {
  // the quote between FSI and PDI, which isolate it from the sentence's direction
  const q = (text: string) => `“\u2068${text}\u2069”`;

  it('says where a field goes, quoting the end of the text before it', () => {
    expect(afterLabel('Name: and more', 5)).toBe(`after ${q('Name:')}`);
    expect(afterLabel('The employee’s National ID:', 27)).toBe(`at the end, after ${q('…employee’s National ID:')}`);
    expect(afterLabel('Name: ', 6)).toBe(`at the end, after ${q('Name:')}`);
    expect(afterLabel('الاسم: ثم الرقم القومي:', 23)).toBe(`at the end, after ${q('الاسم: ثم الرقم القومي:')}`);
    expect(afterLabel('  Name', 1)).toBe('at the start of the line');
    expect(afterLabel('x', 0)).toBe('at the start of the line');
    expect(afterLabel('Averyveryverylongwordwithoutanyspaces end', 37)).toBe(`after ${q('…longwordwithoutanyspaces')}`);
  });
});

describe('offsetAfter', () => {
  const l = line('Name: {{nam}} the Employee, ID ');

  it('finds the offset just after the first occurrence of a typed text, ignoring capitals and the spaces around it', () => {
    expect(offsetAfter(l, 'Name:')).toEqual({ offset: 5 });
    expect(offsetAfter(l, '  the employee ')).toEqual({ offset: 26 });
    expect(offsetAfter(line('الاسم: ثم'), 'الاسم:')).toEqual({ offset: 6 });
  });

  it('says why when the text is empty, not in the line, or ends inside a tag', () => {
    expect(offsetAfter(l, '  ')).toEqual({ error: 'Type a word or phrase from the line.' });
    expect(offsetAfter(l, 'Salary')).toEqual({ error: '“Salary” is not in this line: type it as it is written there.' });
    expect(offsetAfter(l, '{{na')).toEqual({ error: '“{{na” ends in the middle of a tag: choose another text.' });
  });
});

describe('pickerGroups', () => {
  it('lists every tag by group with an empty search, in the tag list’s order', () => {
    const groups = pickerGroups('');
    expect(groups.reduce((n, g) => n + g.tags.length, 0)).toBe(TEMPLATE_TAGS.length);
    expect(groups[0]).toMatchObject({ group: 'employee', label: 'Employee' });
  });

  it('keeps only the tags that match, by tag or by English or Arabic label, and leaves out empty groups', () => {
    expect(pickerGroups('national_id').flatMap((g) => g.tags.map((t) => t.tag))).toContain('national_id');
    expect(pickerGroups('رقم قومي').flatMap((g) => g.tags.map((t) => t.tag))).toContain('national_id');
    expect(pickerGroups('zzzz')).toEqual([]);
    expect(pickerGroups('national id').every((g) => g.tags.length > 0)).toBe(true);
  });
});

describe('the summary', () => {
  it('counts fields put in (at a point or in a blank), changed and removed', () => {
    expect(countEdits([{ kind: 'add' }, { kind: 'fill' }, { kind: 'change' }, { kind: 'remove' }, { kind: 'add' }])).toEqual({
      added: 3,
      changed: 1,
      removed: 1,
      total: 5,
    });
  });

  it('says it in one line, with "field" once', () => {
    expect(summaryText({ added: 3, changed: 1, removed: 1 })).toBe('3 fields added, 1 changed, 1 removed');
    expect(summaryText({ added: 1, changed: 0, removed: 0 })).toBe('1 field added');
    expect(summaryText({ added: 0, changed: 2, removed: 1 })).toBe('2 fields changed, 1 removed');
    expect(summaryText({ added: 0, changed: 0, removed: 1 })).toBe('1 field removed');
    expect(summaryText({ added: 0, changed: 0, removed: 0 })).toBe('No changes yet');
  });

  it('describes each change', () => {
    expect(describeEdit({ kind: 'add', tag: 'date', was: null })).toBe('{{date}} added');
    expect(describeEdit({ kind: 'fill', tag: 'date', was: null })).toBe('{{date}} put in a blank');
    expect(describeEdit({ kind: 'change', tag: 'full_name_ar', was: 'nam' })).toBe('{{nam}} changed to {{full_name_ar}}');
    expect(describeEdit({ kind: 'remove', tag: null, was: 'nam' })).toBe('{{nam}} removed');
  });
});

describe('saving', () => {
  const a = line('Name: {{nam}}', {}, 'a');
  const b = line('ID: ....', {}, 'b');
  const edits = [edit(fillBlank(b, 0, 'national_id', 'e1')), edit(addAt(a, a.text.length, 'date', 'e2')), edit(changeTag(a, 0, 'full_name_en', 'e3'))];

  it('sends the changes in the document’s order, with only what the API takes, and the note when there is one', () => {
    expect(buildRequest(edits, [a, b], '  New fields  ')).toEqual({
      edits: [
        { line: 'a', from: 6, to: 13, text: '{{full_name_en}}' },
        { line: 'a', from: 13, to: 13, text: ' {{date}}' },
        { line: 'b', from: 4, to: 8, text: '{{national_id}}' },
      ],
      note: 'New fields',
    });
    expect(buildRequest(edits, [a, b], '   ')).not.toHaveProperty('note');
  });

  it('says why it can’t be saved yet: no change, too many, or a long note', () => {
    expect(saveProblem([])).toBe('Make at least one change first.');
    expect(saveProblem(Array(MAX_EDITS).fill(0))).toBeNull();
    expect(saveProblem(Array(MAX_EDITS + 2).fill(0))).toBe('At most 200 changes can be saved at once: undo 2, save, then map the rest on the new draft.');
    expect(saveProblem([1], 'x'.repeat(501))).toBe('The note must be 500 characters or fewer.');
  });

  it('reads what the page sent, keeping only what the API takes', () => {
    const request = buildRequest(edits, [a, b], 'Mapped');
    const sent = { ...request, edits: request.edits.map((e) => ({ ...e, extra: 'dropped' })) };
    expect(readRequest(sent)).toEqual({ request });
  });

  it('refuses anything else', () => {
    const bad = (e: unknown) => readRequest({ edits: [e] });
    expect(readRequest(null)).toEqual({ errors: ['Make at least one change first.'] });
    expect(readRequest({ edits: [] })).toEqual({ errors: ['Make at least one change first.'] });
    expect('errors' in bad({ line: 'a', from: 3, to: 2, text: '' })).toBe(true);
    expect('errors' in bad({ line: 'a', from: -1, to: 2, text: '' })).toBe(true);
    expect('errors' in bad({ line: 'a', from: 1.5, to: 2, text: '' })).toBe(true);
    expect('errors' in bad({ line: '', from: 0, to: 0, text: '{{date}}' })).toBe(true);
    expect('errors' in bad({ line: 'a', from: 0, to: 0, text: 'some words' })).toBe(true);
    expect('errors' in bad({ line: 'a', from: 0, to: 0, text: '  {{date}}' })).toBe(true);
    expect('errors' in bad({ line: 'a', from: 0, to: 0, text: ' {{date}} ' })).toBe(false);
  });
});
