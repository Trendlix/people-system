import { SetupFrame } from '../setup-menu';

export default function Layout({ children }: LayoutProps<'/organization/contracts'>) {
  return <SetupFrame active="contracts">{children}</SetupFrame>;
}
