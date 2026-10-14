import { OrgTabs } from '../tabs';

export default function Layout({ children }: LayoutProps<'/organization/grades'>) {
  return <OrgTabs active="grades">{children}</OrgTabs>;
}
