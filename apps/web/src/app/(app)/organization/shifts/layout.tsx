import { OrgTabs } from '../tabs';

export default function Layout({ children }: LayoutProps<'/organization/shifts'>) {
  return <OrgTabs active="shifts">{children}</OrgTabs>;
}
