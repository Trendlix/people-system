import { SetupFrame } from '../setup-menu';

export default function Layout({ children }: LayoutProps<'/organization/grades'>) {
  return <SetupFrame active="grades">{children}</SetupFrame>;
}
