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
