import { TEMPLATE_TAGS, type TemplateTag } from '@trendlix/shared';
import type { TemplateVersion } from '../../../lib/types';

// The check of a template version's tags, as the template page shows it: the tags found that are in the tag list
// (TEMPLATE_TAGS), those that are not, each with the closest known tag suggested, and fragments that look like a tag but
// are broken. Unknown or broken tags block publishing (the API checks this again). Pure code, tested.

const KNOWN: ReadonlyMap<string, TemplateTag> = new Map(TEMPLATE_TAGS.map((t) => [t.tag, t]));
const NAMES: readonly string[] = TEMPLATE_TAGS.map((t) => t.tag);

/**
 * How many single-character edits turn one word into the other: a letter added, removed or changed, or two neighbours
 * swapped ("naem" → "name" is one). The optimal string alignment distance.
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  // d[i][j]: the distance between the first i letters of a and the first j of b
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** As tags are compared for a suggestion: lower case, with spaces and hyphens read as underscores. */
const normal = (tag: string) => tag.trim().toLowerCase().replace(/[\s-]+/g, '_');

/**
 * The known tag an unknown one was most likely meant to be (a typo, a letter in capitals, a missing underscore), or null
 * when none is close: at most one edit in four letters (one for "nmae", three for "employe_cod"). Of equally close tags,
 * the first in the tag list.
 */
export function closestTag(written: string, known: readonly string[] = NAMES): string | null {
  const word = normal(written);
  if (!word) return null;
  const allowed = Math.max(1, Math.round(word.length / 4));
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const tag of known) {
    const distance = editDistance(word, tag.toLowerCase());
    if (distance < bestDistance) {
      best = tag;
      bestDistance = distance;
    }
  }
  return bestDistance <= allowed ? best : null;
}

/** "1 tag", "2 tags" */
export function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export interface TagCheck {
  /** The tags found that are in the tag list, in the order found, each once. */
  known: TemplateTag[];
  /** The tags found that are not, each once, with the closest known tag (or null). */
  unknown: { tag: string; suggestion: string | null }[];
  /** Fragments that look like a tag but are broken, as written in the file. */
  broken: string[];
  /** Why the version can't be published, or null when it can. */
  blocked: string | null;
}

const unique = (values: readonly string[]) => [...new Set(values)];

/** The check of a version's tags (unknown ones counted whether the API lists them as unknown or among the tags found). */
export function checkTags(version: Pick<TemplateVersion, 'tags' | 'unknownTags' | 'broken'>): TagCheck {
  const found = unique(version.tags ?? []);
  const known = found.flatMap((t) => KNOWN.get(t) ?? []);
  const unknown = unique([...(version.unknownTags ?? []), ...found.filter((t) => !KNOWN.has(t))]).map((tag) => ({ tag, suggestion: closestTag(tag) }));
  const broken = unique(version.broken ?? []);
  return { known, unknown, broken, blocked: publishBlock(unknown.length, broken.length) };
}

/** Why a draft with these many unknown and broken tags can't be published, or null when it can. */
export function publishBlock(unknown: number, broken: number): string | null {
  if (!unknown && !broken) return null;
  const problems = [
    unknown ? `${count(unknown, 'tag')} ${unknown === 1 ? 'is' : 'are'} not in the tag list` : '',
    broken ? `${count(broken, 'tag')} ${broken === 1 ? 'is' : 'are'} broken` : '',
  ].filter(Boolean);
  return `Can't be published yet: ${problems.join(' and ')}. Fix ${unknown + broken === 1 ? 'it' : 'them'} in Word, then upload the file again.`;
}

/** The total number of distinct tags found in a version, known and unknown. */
export function tagCount(version: Pick<TemplateVersion, 'tags' | 'unknownTags'>): number {
  return unique([...(version.tags ?? []), ...(version.unknownTags ?? [])]).length;
}

/** Arabic as compared in a search: without vowel marks or tatweel, and with the forms of alef, ta marbuta and alef maqsura made one. */
const arabic = (s: string) =>
  s
    .replace(/[\u064B-\u0652\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي');

/**
 * Whether a tag matches what was typed in the tag reference's search box: its name (with or without the braces) or its
 * English or Arabic label contains it, ignoring capitals and the forms of Arabic letters (`arabic`), and reading spaces
 * as underscores in names. An empty search matches every tag.
 */
export function matchesTag(tag: Pick<TemplateTag, 'tag' | 'labelEn' | 'labelAr'>, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const asName = q.replace(/^\{+|\}+$/g, '').trim().replace(/[\s-]+/g, '_');
  if (!asName) return true; // only braces: every tag is written with them
  return tag.tag.toLowerCase().includes(asName) || tag.labelEn.toLowerCase().includes(q) || arabic(tag.labelAr).includes(arabic(q));
}
