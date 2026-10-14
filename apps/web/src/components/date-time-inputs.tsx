// Date and time fields typed as DD/MM/YYYY and 12-hour time. The browser's own date and time pickers follow the
// computer's region settings (often MM/DD/YYYY or 24-hour), so plain text fields are used instead; the form
// action turns what was typed into the API's format with dateFrom / timeFrom (lib/form-data.ts).

type FieldProps = {
  id: string;
  name: string;
  /** Already formatted for display: DD/MM/YYYY or "9:00 AM" (use formatDate / formatTime, or what was typed). */
  defaultValue: string;
  required?: boolean;
  'aria-describedby'?: string;
};

export function DateInput(props: FieldProps) {
  return (
    <input
      {...props}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder="DD/MM/YYYY"
      maxLength={10}
      className="input"
    />
  );
}

export function TimeInput(props: FieldProps) {
  return <input {...props} type="text" autoComplete="off" placeholder="9:00 AM" maxLength={8} className="input" />;
}
