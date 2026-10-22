import Link from 'next/link';
import { Hidden } from '@/components/hidden';
import { leadHidden } from '@/lib/department-leads';
import type { LeadPerson } from '@/lib/types';

/**
 * The person in charge of a department or team (owner, 19 October 2026: "i want to add department lead person, the
 * person in charge"), by name: linked to their profile for those who can open every profile (HR, the CEO and Finance),
 * as other names are; plain text for anyone else, who may not be allowed to open it. Hidden, and not linked, for a
 * developer, whom the API sends it without an id or a name (owner, 22 October 2026: "Hide per-person details": who heads
 * a department would say where they work).
 */
export function LeadName({ person, link }: { person: LeadPerson; link: boolean }) {
  if (leadHidden(person)) return <Hidden className="font-medium" />;
  return link ? (
    <Link href={`/employees/${person.id}`} className="font-medium">
      {person.fullNameEn}
    </Link>
  ) : (
    <span className="font-medium">{person.fullNameEn}</span>
  );
}
