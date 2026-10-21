export default function ApprovalsLayout({ children }: LayoutProps<'/approvals'>) {
  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-semibold">Approvals</h1>
      <p className="mt-1 text-muted">
        Endings of employment HR has recorded and approved and pay raises HR has sent, waiting for the CEO, and employees&apos; requests to change
        their details, waiting for HR or an Admin (a C-level person&apos;s, for the CEO or a Super Admin); home locations, decided by HR, then the
        CEO; and KPI scorecards waiting for you to score, calibrate or sign.
      </p>
      <div className="mt-6">{children}</div>
    </div>
  );
}
