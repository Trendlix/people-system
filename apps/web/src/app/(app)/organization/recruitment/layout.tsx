import { SetupFrame } from '../setup-menu';

export default function Layout({ children }: LayoutProps<'/organization/recruitment'>) {
  return <SetupFrame active="recruitment">{children}</SetupFrame>;
}
