import { SetupFrame } from '../setup-menu';

export default function Layout({ children }: LayoutProps<'/organization/whatsapp'>) {
  return <SetupFrame active="whatsapp">{children}</SetupFrame>;
}
