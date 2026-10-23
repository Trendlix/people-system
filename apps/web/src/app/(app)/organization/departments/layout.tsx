import { SetupFrame } from '../setup-menu';

export default function Layout({ children }: LayoutProps<'/organization/departments'>) {
  return <SetupFrame active="departments">{children}</SetupFrame>;
}
