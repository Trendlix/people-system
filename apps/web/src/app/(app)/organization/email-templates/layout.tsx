import { SetupFrame } from '../setup-menu';

export default function Layout({ children }: LayoutProps<'/organization/email-templates'>) {
  return <SetupFrame active="email-templates">{children}</SetupFrame>;
}
