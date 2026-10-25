import { SetupFrame } from '../setup-menu';

export default function Layout({ children }: LayoutProps<'/organization/zoho-people'>) {
  return <SetupFrame active="zoho-people">{children}</SetupFrame>;
}
