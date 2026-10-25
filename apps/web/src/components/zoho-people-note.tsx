import type { ZohoPeopleNote } from '@trendlix/shared';
import Link from 'next/link';
import { ApiError, apiFetch } from '@/lib/api';
import { noteOf, ZOHO_PEOPLE_SETTINGS_PATH } from '@/lib/zoho-people';

// The home page's note to HR and a Super Admin (the brief, 25 October 2026: "On failure (expired token, Zoho down), a
// clear status on the page and a dashboard note for Super Admin and HR"): when last night's fetch from Zoho People
// failed, or its connection needs connecting again, the API says so (GET /zoho-people/note), with the way to Organization
// → Zoho People. Anyone else (refused), an API from before it, or the API down: nothing shown, so the home page never
// fails for it. Asked in the background, as the sidebar's counts are: it isn't the person's own activity.

export async function ZohoPeopleNoteBanner() {
  let note: ZohoPeopleNote = null;
  try {
    const res = await apiFetch('/zoho-people/note', undefined, { background: true });
    if (res.ok) {
      const text = await res.text();
      note = text ? noteOf(JSON.parse(text)) : null;
    }
  } catch (err) {
    // the API unreachable, or an answer that isn't JSON: nothing shown (anything else, e.g. Next's own, goes on)
    if (!(err instanceof ApiError) && !(err instanceof SyntaxError)) throw err;
  }
  if (!note) return null;
  return (
    <p
      role="status"
      className={`mt-6 flex max-w-4xl flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg px-4 py-3 text-sm font-semibold ${note.tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-warn-soft text-warn'}`}
    >
      {note.text}
      <Link href={ZOHO_PEOPLE_SETTINGS_PATH} className="btn btn-secondary min-h-9 px-3">
        Open Zoho People
      </Link>
    </p>
  );
}
