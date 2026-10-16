export default function ApprovalsLayout({ children }: LayoutProps<'/approvals'>) {
  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-semibold">Approvals</h1>
      <p className="mt-1 text-muted">
        Endings of employment HR has recorded and approved and pay raises HR has sent, waiting for the CEO, and employees&apos; requests to change
        their details, waiting for HR or an Admin.
      </p>
      <div className="mt-6">{children}</div>
    </div>
  );
}
