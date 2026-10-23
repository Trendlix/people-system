import { SetupFrame } from '../setup-menu';

export default function Layout({ children }: LayoutProps<'/organization/clearance-checklist'>) {
  return <SetupFrame active="clearance-checklist">{children}</SetupFrame>;
}
