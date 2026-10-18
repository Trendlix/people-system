import { OrgTabs } from '../tabs';

export default function Layout({ children }: LayoutProps<'/organization/leave'>) {
  return <OrgTabs active="leave">{children}</OrgTabs>;
}
