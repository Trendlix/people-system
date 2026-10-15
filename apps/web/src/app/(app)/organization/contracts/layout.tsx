import { OrgTabs } from '../tabs';

export default function Layout({ children }: LayoutProps<'/organization/contracts'>) {
  return <OrgTabs active="contracts">{children}</OrgTabs>;
}
