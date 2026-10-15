import { TEMPLATE_TAGS } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import { checkTags, closestTag, count, editDistance, matchesTag, publishBlock, tagCount } from './tag-check';

describe('editDistance', () => {
  it('is 0 for the same word, and the length of the other for an empty one', () => {
    expect(editDistance('date', 'date')).toBe(0);
    expect(editDistance('', 'date')).toBe(4);
    expect(editDistance('date', '')).toBe(4);
  });

  it('counts a letter added, removed or changed as one edit', () => {
    expect(editDistance('full_nam_ar', 'full_name_ar')).toBe(1);
    expect(editDistance('full_name_arr', 'full_name_ar')).toBe(1);
    expect(editDistance('full_neme_ar', 'full_name_ar')).toBe(1);
    expect(editDistance('kitten', 'sitting')).toBe(3);
  });

  it('counts two neighbouring letters swapped as one edit', () => {
    expect(editDistance('naem', 'name')).toBe(1);
    expect(editDistance('ful_lname_ar', 'full_name_ar')).toBe(1);
  });
});

describe('closestTag', () => {
  it('suggests the tag a typo was meant to be', () => {
    expect(closestTag('full_nam_ar')).toBe('full_name_ar');
    expect(closestTag('fullname_ar')).toBe('full_name_ar');
    expect(closestTag('nationl_id')).toBe('national_id');
    expect(closestTag('gross_salery')).toBe('gross_salary');
    expect(closestTag('employe_cod')).toBe('employee_code');
  });

  it('reads capitals, spaces and hyphens as the tag list writes them', () => {
    expect(closestTag('Full_Name_AR')).toBe('full_name_ar');
    expect(closestTag('join date')).toBe('join_date');
    expect(closestTag('start-date')).toBe('start_date');
  });

  it('suggests nothing when no tag is close', () => {
    expect(closestTag('salary')).toBeNull();
    expect(closestTag('xyz')).toBeNull();
    expect(closestTag('')).toBeNull();
    expect(closestTag('   ')).toBeNull();
  });

  it('allows one edit in four letters, so short words need a close match', () => {
    expect(closestTag('dat')).toBe('date');
    expect(closestTag('name')).toBeNull(); // "date" is two edits away
  });

  it('takes the first of equally close tags, in the list given', () => {
    expect(closestTag('ab', ['ac', 'ad'])).toBe('ac');
  });
});

describe('checkTags', () => {
  it('splits the tags found into known ones, with their labels, and unknown ones, with a suggestion', () => {
    const check = checkTags({ tags: ['full_name_ar', 'national_id', 'full_nam_ar', 'full_name_ar'], unknownTags: ['full_nam_ar'], broken: [] });
    expect(check.known.map((t) => t.tag)).toEqual(['full_name_ar', 'national_id']);
    expect(check.known[1]).toMatchObject({ labelEn: 'National ID number', labelAr: 'رقم قومي', restricted: true });
    expect(check.unknown).toEqual([{ tag: 'full_nam_ar', suggestion: 'full_name_ar' }]);
    expect(check.blocked).toBe("Can't be published yet: 1 tag is not in the tag list. Fix it in Word, then upload the file again.");
  });

  it('counts an unknown tag the API lists only among the tags found', () => {
    const check = checkTags({ tags: ['date', 'mystery_tag'], unknownTags: [], broken: [] });
    expect(check.unknown).toEqual([{ tag: 'mystery_tag', suggestion: null }]);
    expect(check.blocked).not.toBeNull();
  });

  it('blocks publishing for broken tags, each listed once', () => {
    const check = checkTags({ tags: ['date'], unknownTags: [], broken: ['{{full_name_ar}', '{{full_name_ar}'] });
    expect(check.broken).toEqual(['{{full_name_ar}']);
    expect(check.blocked).toBe("Can't be published yet: 1 tag is broken. Fix it in Word, then upload the file again.");
  });

  it('lets a draft with only known tags, or none at all, be published', () => {
    expect(checkTags({ tags: TEMPLATE_TAGS.map((t) => t.tag), unknownTags: [], broken: [] }).blocked).toBeNull();
    const empty = checkTags({ tags: [], unknownTags: [], broken: [] });
    expect(empty).toEqual({ known: [], unknown: [], broken: [], blocked: null });
  });
});

describe('publishBlock', () => {
  it('says what keeps a draft from being published', () => {
    expect(publishBlock(0, 0)).toBeNull();
    expect(publishBlock(2, 0)).toBe("Can't be published yet: 2 tags are not in the tag list. Fix them in Word, then upload the file again.");
    expect(publishBlock(0, 3)).toBe("Can't be published yet: 3 tags are broken. Fix them in Word, then upload the file again.");
    expect(publishBlock(1, 1)).toBe("Can't be published yet: 1 tag is not in the tag list and 1 tag is broken. Fix them in Word, then upload the file again.");
  });
});

describe('tagCount and count', () => {
  it('counts the distinct tags found, known and unknown', () => {
    expect(tagCount({ tags: ['date', 'date', 'full_name_ar'], unknownTags: ['oops'] })).toBe(3);
    expect(tagCount({ tags: ['date', 'oops'], unknownTags: ['oops'] })).toBe(2);
  });

  it('words a count in the singular or the plural', () => {
    expect(count(1, 'tag')).toBe('1 tag');
    expect(count(0, 'tag')).toBe('0 tags');
    expect(count(22, 'template')).toBe('22 templates');
  });
});

describe('matchesTag', () => {
  const tag = TEMPLATE_TAGS.find((t) => t.tag === 'full_name_ar')!;

  it('matches every tag for an empty search', () => {
    expect(matchesTag(tag, '')).toBe(true);
    expect(matchesTag(tag, '   ')).toBe(true);
  });

  it('matches by the tag, with or without braces, and spaces for underscores', () => {
    expect(matchesTag(tag, 'name_ar')).toBe(true);
    expect(matchesTag(tag, '{{full_name_ar}}')).toBe(true);
    expect(matchesTag(tag, 'FULL NAME')).toBe(true);
    expect(matchesTag(tag, '{{')).toBe(true); // only braces: every tag has them
  });

  it('matches by the English or the Arabic label', () => {
    expect(matchesTag(tag, 'full name (arabic)')).toBe(true);
    expect(matchesTag(tag, 'الاسم')).toBe(true);
    expect(matchesTag(tag, 'الإسم')).toBe(true); // alef with hamza, as often typed
  });

  it("doesn't match what isn't there", () => {
    expect(matchesTag(tag, 'salary')).toBe(false);
    expect(matchesTag(tag, 'راتب')).toBe(false);
  });
});
