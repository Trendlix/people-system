import { OrgTabs } from '../tabs';

export default function Layout({ children }: LayoutProps<'/organization/allowances'>) {
  return <OrgTabs active="allowances">{children}</OrgTabs>;
}
