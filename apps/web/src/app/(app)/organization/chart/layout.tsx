import { OrgTabs } from '../tabs';

// The org chart is drawn from Departments & Job Titles, so that tab stays selected.
export default function Layout({ children }: { children: React.ReactNode }) {
  return <OrgTabs active="departments">{children}</OrgTabs>;
}
