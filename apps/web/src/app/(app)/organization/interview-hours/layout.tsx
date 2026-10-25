import { SetupFrame } from '../setup-menu';

export default function Layout({ children }: LayoutProps<'/organization/interview-hours'>) {
  return <SetupFrame active="interview-hours">{children}</SetupFrame>;
}
