import { SetupFrame } from '../setup-menu';

export default function Layout({ children }: LayoutProps<'/organization/shifts'>) {
  return <SetupFrame active="shifts">{children}</SetupFrame>;
}
