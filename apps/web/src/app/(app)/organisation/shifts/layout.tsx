import { OrgTabs } from '../tabs';

export default function Layout({ children }: LayoutProps<'/organisation/shifts'>) {
  return <OrgTabs active="shifts">{children}</OrgTabs>;
}
