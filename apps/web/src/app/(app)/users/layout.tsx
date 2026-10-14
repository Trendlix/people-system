export default function UsersLayout({ children }: LayoutProps<'/users'>) {
  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-semibold">Users</h1>
      <p className="mt-1 text-muted">Sign-in accounts for colleagues, and the roles that decide what each one can see and do.</p>
      <div className="mt-6">{children}</div>
    </div>
  );
}
