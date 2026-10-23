import { SetupFrame } from '../setup-menu';

export default function Layout({ children }: LayoutProps<'/organization/check-in-setup'>) {
  return <SetupFrame active="check-in-setup">{children}</SetupFrame>;
}
