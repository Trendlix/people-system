import { SetupFrame } from '../setup-menu';

// The org chart is drawn from Departments & Job Titles, so that page stays marked in the setup menu.
export default function Layout({ children }: { children: React.ReactNode }) {
  return <SetupFrame active="departments">{children}</SetupFrame>;
}
