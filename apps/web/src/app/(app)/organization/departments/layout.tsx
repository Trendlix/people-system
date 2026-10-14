import { OrgTabs } from '../tabs';

export default function Layout({ children }: LayoutProps<'/organization/departments'>) {
  return <OrgTabs active="departments">{children}</OrgTabs>;
}
