export default function OrganizationLayout({ children }: LayoutProps<'/organization'>) {
  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-semibold">Organization</h1>
      <p className="mt-1 text-muted">Company details, departments with their teams and the job titles in each (and their job descriptions), grades, work shifts, the kinds of allowance paid on top of the salary, how contracts start and end, and the payroll rules.</p>
      {children}
    </div>
  );
}
