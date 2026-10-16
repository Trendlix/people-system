import { OrgTabs } from '../tabs';

export default function Layout({ children }: LayoutProps<'/organization/holidays'>) {
  return <OrgTabs active="holidays">{children}</OrgTabs>;
}
