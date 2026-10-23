import { SetupFrame } from '../setup-menu';

export default function Layout({ children }: LayoutProps<'/organization/kpi-deadlines'>) {
  return <SetupFrame active="kpi-deadlines">{children}</SetupFrame>;
}
