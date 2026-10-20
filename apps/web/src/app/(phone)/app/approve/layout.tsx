import { AppSectionProvider } from '@/components/surface';

// The phone pages' To Approve and every page under it (owner, 20 October 2026: the employee app, "managers and team
// leads approve from the phone"): the decision forms here say so (components/surface.tsx), so once decided they come
// back here.

export default function PhoneApproveLayout({ children }: LayoutProps<'/app/approve'>) {
  return <AppSectionProvider section="approve">{children}</AppSectionProvider>;
}
