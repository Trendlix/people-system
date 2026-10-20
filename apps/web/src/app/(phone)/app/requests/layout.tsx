import { AppSectionProvider } from '@/components/surface';

// The phone pages' My Requests and every page under it (owner, 20 October 2026: the employee app, "apply for their
// requests"): the forms here say so (components/surface.tsx), so once sent, cancelled or decided they come back here.

export default function PhoneRequestsLayout({ children }: LayoutProps<'/app/requests'>) {
  return <AppSectionProvider section="requests">{children}</AppSectionProvider>;
}
