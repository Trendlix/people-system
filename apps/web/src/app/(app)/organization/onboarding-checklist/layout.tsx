import { SetupFrame } from '../setup-menu';

export default function Layout({ children }: LayoutProps<'/organization/onboarding-checklist'>) {
  return <SetupFrame active="onboarding-checklist">{children}</SetupFrame>;
}
