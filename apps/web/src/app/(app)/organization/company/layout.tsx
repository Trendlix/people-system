import { OrgTabs } from '../tabs';

export default function Layout({ children }: LayoutProps<'/organization/company'>) {
  return <OrgTabs active="company">{children}</OrgTabs>;
}
