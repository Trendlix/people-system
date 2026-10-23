import { StaffOnly } from '../staff-only';

// Not an employee's: someone who is only an employee and/or a direct manager is sent to their dashboard (owner, 17
// October 2026: "dont show him the organization tab"). The heading, its words and the setup menu (owner, 23 October 2026:
// "Side menu with headings") are each section's layout's (setup-menu.tsx SetupFrame), which knows the page it is on; a
// template's Place Fields, a full-width working page reached from its template, has none of them.
export default function OrganizationLayout({ children }: LayoutProps<'/organization'>) {
  return <StaffOnly>{children}</StaffOnly>;
}
