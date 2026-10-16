import { OrgTabs } from '../tabs';

export default function Layout({ children }: LayoutProps<'/organization/payroll'>) {
  return <OrgTabs active="payroll">{children}</OrgTabs>;
}
