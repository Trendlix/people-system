import { lawWarnings } from './employment-law';

// HR's warnings by the labour law (owner, 18 October 2026: "can we update the employment types based on the labour
// law?"), as the API works them out: a fixed-term contract that has become open-ended (Art. 88(3)) and casual work past
// its 6 months (Art. 1(7)). As badges in the lists and beside the contract, and spelled out on the profile.

type Warned = { becameOpenEnded?: boolean; casualTooLong?: boolean };

/** The warnings as badges (nothing without any); what each means shows on hover. */
export function LawWarningBadges({ of }: { of: Warned }) {
  const warnings = lawWarnings(of);
  if (!warnings.length) return null;
  return (
    <>
      {warnings.map((w) => (
        <span key={w.key} title={w.detail} className="badge bg-danger-soft whitespace-nowrap text-danger">
          {w.text}
        </span>
      ))}
    </>
  );
}

/** The warnings spelled out, each with what to do (nothing without any). */
export function LawWarningNotes({ of }: { of: Warned }) {
  const warnings = lawWarnings(of);
  if (!warnings.length) return null;
  return (
    <ul role="alert" className="space-y-2 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
      {warnings.map((w) => (
        <li key={w.key}>
          <span className="font-semibold">{w.text}.</span> {w.detail}
        </li>
      ))}
    </ul>
  );
}
