import { SetupFrame } from '../setup-menu';

export default function Layout({ children }: LayoutProps<'/organization/kpi-pillars'>) {
  return <SetupFrame active="kpi-pillars">{children}</SetupFrame>;
}
