import { OrgTabs } from '../tabs';

export default function Layout({ children }: LayoutProps<'/organisation/job-titles'>) {
  return <OrgTabs active="job-titles">{children}</OrgTabs>;
}
