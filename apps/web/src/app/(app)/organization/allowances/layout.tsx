import { SetupFrame } from '../setup-menu';

export default function Layout({ children }: LayoutProps<'/organization/allowances'>) {
  return <SetupFrame active="allowances">{children}</SetupFrame>;
}
