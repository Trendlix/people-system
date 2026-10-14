import { Transform } from 'class-transformer';

/** Trims a string field. */
export const Trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

/** Trims an optional string field and turns an empty string into null, so "clear this field" works. */
export const TrimOrNull = () =>
  Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  });

/** Arabic-Indic digits (٠-٩) typed on an Arabic keyboard become 0-9. */
export const LatinDigits = () =>
  Transform(({ value }) =>
    typeof value === 'string' ? value.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)) : value,
  );
