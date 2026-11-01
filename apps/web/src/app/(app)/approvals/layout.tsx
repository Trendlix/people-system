export default function ApprovalsLayout({ children }: LayoutProps<'/approvals'>) {
  return (
    <div className="max-w-5xl">
      <h1 className="page-title">Approvals</h1>
      <div className="mt-6">{children}</div>
    </div>
  );
}
