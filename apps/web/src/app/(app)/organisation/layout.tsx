export default function OrganisationLayout({ children }: LayoutProps<'/organisation'>) {
  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-semibold">Organisation</h1>
      <p className="mt-1 text-muted">Company details, departments, job titles with their job descriptions, and work shifts.</p>
      {children}
    </div>
  );
}
