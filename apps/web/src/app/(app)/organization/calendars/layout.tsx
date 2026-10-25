import { SetupFrame } from '../setup-menu';

export default function Layout({ children }: LayoutProps<'/organization/calendars'>) {
  return <SetupFrame active="calendars">{children}</SetupFrame>;
}
