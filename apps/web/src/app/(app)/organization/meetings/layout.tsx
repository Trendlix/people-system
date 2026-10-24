import { SetupFrame } from '../setup-menu';

export default function Layout({ children }: LayoutProps<'/organization/meetings'>) {
  return <SetupFrame active="meetings">{children}</SetupFrame>;
}
