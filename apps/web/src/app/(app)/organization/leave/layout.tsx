import { SetupFrame } from '../setup-menu';

export default function Layout({ children }: LayoutProps<'/organization/leave'>) {
  return <SetupFrame active="leave">{children}</SetupFrame>;
}
