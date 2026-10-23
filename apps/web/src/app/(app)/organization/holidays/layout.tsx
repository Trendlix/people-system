import { SetupFrame } from '../setup-menu';

export default function Layout({ children }: LayoutProps<'/organization/holidays'>) {
  return <SetupFrame active="holidays">{children}</SetupFrame>;
}
