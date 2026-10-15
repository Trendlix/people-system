import { offerSlotKey, TEMPLATE_TAGS, type TemplateSlot } from '@trendlix/shared';
import { rightFor, sourceTag, type RestrictedRight } from './values.js';

// Previewing a template version with a real employee's data (owner's request, 15 October 2026: "When previewing a
// template, fetch any demo data already uploaded"): every tag the version prints, worked out as generation works it
// out, but nothing is refused and nothing saved. A tag with no value prints as its label in square brackets ("[Job
// title]"), so the gap shows where it falls on the page; a restricted value (national ID, salary, bank account) the
// caller may not see prints as ••••, whether there is one or not. Pure: DocumentsService.previewFill resolves the values
// and says which are empty.

/**
 * Whether a slot is an employment type's job offer template (offerSlotKey): previewed with a job offer's data rather
 * than an employee's (owner's request, 15 October 2026: "Job offer preview should call data from the offer tab, even if
 * not published yet").
 */
export const isOfferSlot = (slot: Pick<TemplateSlot, 'key' | 'appliesTo'>): boolean => slot.appliesTo.some((t) => offerSlotKey(t) === slot.key);

/** What a restricted value the caller may not see prints as. */
export const MASK = '••••';

const LABELS = new Map(TEMPLATE_TAGS.map((t) => [t.tag, t.labelEn]));

/** What a tag with no value prints as: its label in square brackets, "[Job title]" (the tag, for one the dictionary doesn't have). */
export const placeholder = (tag: string): string => `[${LABELS.get(tag) ?? tag}]`;

export interface PreviewValues<V> {
  /** Each tag's printed value: its own, its placeholder, or the mask. */
  values: Record<string, V | string>;
  /** How many of the tags have a value, whoever is looking. */
  filled: number;
  /** How many tags the version prints (each once). */
  total: number;
  /** The restricted tags printed with their value: a view of restricted data, for the audit log. */
  shown: string[];
  /**
   * The tags printed as their placeholder (no value, and not masked): a PDF form's optional fields print these blank,
   * as the document would (owner, 15 October 2026).
   */
  placeholders: string[];
}

/**
 * What a preview prints for each of `tags`: its value (`empty` holds those without one), else its placeholder; the mask
 * for a tag that needs a right the caller lacks (`may`), read through the slot's overrides as generation reads it.
 */
export function previewValues<V>(
  tags: readonly string[],
  values: Readonly<Record<string, V>>,
  empty: ReadonlySet<string>,
  overrides: Readonly<Record<string, string>> | undefined,
  may: Readonly<Record<RestrictedRight, boolean>>,
): PreviewValues<V> {
  const out: Record<string, V | string> = {};
  const shown: string[] = [];
  const placeholders: string[] = [];
  let filled = 0;
  for (const tag of new Set(tags)) {
    const has = !empty.has(tag) && values[tag] !== undefined;
    if (has) filled++;
    const rights = [rightFor(tag), rightFor(sourceTag(tag, overrides))].filter((r): r is RestrictedRight => r !== null);
    if (rights.some((r) => !may[r])) {
      out[tag] = MASK;
    } else if (!has) {
      out[tag] = placeholder(tag);
      placeholders.push(tag);
    } else {
      out[tag] = values[tag];
      if (rights.length) shown.push(tag);
    }
  }
  return { values: out, filled, total: Object.keys(out).length, shown, placeholders };
}
