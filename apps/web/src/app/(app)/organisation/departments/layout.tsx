import { OrgTabs } from '../tabs';

export default function Layout({ children }: LayoutProps<'/organisation/departments'>) {
  return <OrgTabs active="departments">{children}</OrgTabs>;
}
