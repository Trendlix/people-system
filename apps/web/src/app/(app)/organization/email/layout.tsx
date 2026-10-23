import { SetupFrame } from '../setup-menu';

export default function Layout({ children }: LayoutProps<'/organization/email'>) {
  return <SetupFrame active="email">{children}</SetupFrame>;
}
