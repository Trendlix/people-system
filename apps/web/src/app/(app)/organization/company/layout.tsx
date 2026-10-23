import { SetupFrame } from '../setup-menu';

export default function Layout({ children }: LayoutProps<'/organization/company'>) {
  return <SetupFrame active="company">{children}</SetupFrame>;
}
