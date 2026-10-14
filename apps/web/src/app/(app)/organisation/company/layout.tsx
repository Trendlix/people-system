import { OrgTabs } from '../tabs';

export default function Layout({ children }: LayoutProps<'/organisation/company'>) {
  return <OrgTabs active="company">{children}</OrgTabs>;
}
