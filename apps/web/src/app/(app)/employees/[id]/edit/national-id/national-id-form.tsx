'use client';

import Link from 'next/link';
import { GENDERS, GOVERNORATES, LABELS, MARITAL_STATUSES, type Gender, type MaritalStatus } from '@trendlix/shared';
import { DateInput } from '@/components/date-time-inputs';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import { formatDate } from '@/lib/format';
import type { EmployeeIdentity, EmployeeProfile, FormState } from '@/lib/types';
import { cardMarks, NationalIdFields, ReadValues, type CardSuggestions as Suggestions } from '../../../id-card';

/** The profile's current values for the personal details printed on an ID card. */
export type CardProfile = Pick<
  EmployeeProfile,
  'fullNameAr' | 'addressAr' | 'city' | 'governorate' | 'dateOfBirth' | 'gender' | 'maritalStatus' | 'nationality'
>;

const PERSONAL = [
  { key: 'fullNameAr', label: 'Full name (Arabic)' },
  { key: 'addressAr', label: 'Address (Arabic)' },
  { key: 'city', label: 'City' },
  { key: 'governorate', label: 'Governorate' },
  { key: 'dateOfBirth', label: 'Date of birth' },
  { key: 'gender', label: 'Gender' },
  { key: 'maritalStatus', label: 'Marital status' },
  { key: 'nationality', label: 'Nationality' },
] as const;
type PersonalKey = (typeof PERSONAL)[number]['key'];

/** The details written in Arabic, as printed on the card. */
const ARABIC: readonly PersonalKey[] = ['fullNameAr', 'addressAr', 'city'];

const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? '').replace(/\s+/g, ' ').trim() === (b ?? '').replace(/\s+/g, ' ').trim();

/** A profile value as the page shows it. */
function shown(key: PersonalKey, value: string | null): React.ReactNode {
  if (!value) return <span className="text-muted">Not set</span>;
  if (key === 'dateOfBirth') return formatDate(value);
  if (key === 'gender') return LABELS.gender[value as Gender] ?? value;
  if (key === 'maritalStatus') return LABELS.maritalStatus[value as MaritalStatus] ?? value;
  if (!ARABIC.includes(key)) return value;
  return (
    <span lang="ar" dir="rtl">
      {value}
    </span>
  );
}

/** The choices for a detail the card gives as one of a list. */
function choices(key: 'gender' | 'maritalStatus' | 'governorate'): { value: string; label: string }[] {
  if (key === 'gender') return GENDERS.map((g) => ({ value: g, label: LABELS.gender[g] }));
  if (key === 'maritalStatus') return MARITAL_STATUSES.map((m) => ({ value: m, label: LABELS.maritalStatus[m] }));
  return GOVERNORATES.map((g) => ({ value: g, label: g }));
}

/**
 * The national ID details. After the ID card is read (`suggestions`), the fields start with what the card says and
 * are marked for checking (`corrected`: those a fix learned from HR's earlier corrections changed), and the card's
 * personal details can be ticked to save to the profile too.
 */
export function NationalIdForm({
  action,
  employeeId,
  identity,
  suggestions,
  corrected,
  profile,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  employeeId: string;
  identity: EmployeeIdentity;
  suggestions?: Suggestions;
  corrected?: readonly string[];
  profile?: CardProfile;
}) {
  // Kept form: a refused save leaves the gender read from the card as it was chosen.
  const { state, pending, form } = useKeptForm(action);
  const fid = useFieldIds();
  const s: Suggestions = suggestions ?? {};

  const { read, noteText } = cardMarks(fid, s, corrected);

  // Personal details the card gives that differ from the profile; the matching ones are only listed.
  const personal = profile ? PERSONAL.filter((f) => read(f.key)) : [];
  const differing = personal.filter((f) => !same(s[f.key], profile?.[f.key]));
  const matching = personal.filter((f) => same(s[f.key], profile?.[f.key]));
  /** Ticked: what was ticked before a failed save; at first, the details the profile does not have yet. */
  const ticked = (key: PersonalKey) => {
    if (state.values) {
      const apply = state.values.apply;
      return Array.isArray(apply) ? apply.includes(key) : apply === key;
    }
    return !profile?.[key];
  };

  function personalControl(key: PersonalKey, id: string, describedById: string) {
    const name = `card_${key}`;
    if (key === 'dateOfBirth')
      return <DateInput id={id} name={name} aria-describedby={describedById} defaultValue={valueOf(state, name, formatDate(s.dateOfBirth))} />;
    if (key === 'gender' || key === 'maritalStatus' || key === 'governorate')
      return (
        <select id={id} name={name} aria-describedby={describedById} defaultValue={valueOf(state, name, s[key])} className="input">
          {choices(key).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    const common = { id, name, 'aria-describedby': describedById, defaultValue: valueOf(state, name, s[key]), className: 'input' };
    if (key === 'nationality') return <input maxLength={60} {...common} />;
    const ar = { ...common, lang: 'ar', dir: 'rtl' as const };
    if (key === 'addressAr') return <textarea rows={2} maxLength={300} {...ar} />;
    return <input maxLength={key === 'city' ? 100 : 150} {...ar} />;
  }

  return (
    <form {...form} className="card max-w-2xl space-y-5 p-6">
      <FormErrors errors={state.errors} />

      {/* what the reading suggested, to learn from what HR corrects (see learnCorrections) */}
      <ReadValues suggestions={s} />
      <NationalIdFields state={state} fid={fid} identity={identity} suggestions={s} corrected={corrected} />

      {personal.length > 0 && (
        <div className="border-t border-line pt-6">
          <fieldset className="space-y-4">
            <legend className="font-semibold">Personal Details on the Card</legend>
            {differing.length > 0 && (
              <p className="text-sm text-muted">Tick the ones to save to the profile as well. They are saved together with the national ID.</p>
            )}
            {differing.map(({ key, label }) => (
              <div key={key} className="rounded-lg border border-line p-4">
                <label htmlFor={fid(`card_${key}`)} className="label">
                  {label}
                </label>
                {personalControl(key, fid(`card_${key}`), fid(`card_${key}-hint`))}
                <p id={fid(`card_${key}-hint`)} className="hint">
                  <span className="text-warn">{noteText(key)}</span> In the profile now: {shown(key, profile?.[key] ?? null)}
                </p>
                <label className="mt-3 flex min-h-11 w-fit cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm has-checked:border-accent has-checked:bg-accent-soft">
                  <input type="checkbox" name="apply" value={key} defaultChecked={ticked(key)} className="size-4 accent-accent" />
                  Save to the profile<span className="sr-only"> as the {label}</span>
                </label>
              </div>
            ))}
            {matching.length > 0 && (
              <p className="text-sm text-muted">Already the same in the profile: {matching.map((f) => f.label).join(', ')}.</p>
            )}
          </fieldset>
        </div>
      )}

      <div className="flex flex-wrap gap-3 border-t border-line pt-6">
        <SubmitButton busy={pending}>Save national ID</SubmitButton>
        <Link href={`/employees/${employeeId}`} className="btn btn-secondary">
          Cancel
        </Link>
      </div>
    </form>
  );
}
