export default function UsersLayout({ children }: LayoutProps<'/users'>) {
  return (
    <div className="max-w-5xl">
      <h1 className="page-title">Users</h1>
      <div className="mt-6">{children}</div>
    </div>
  );
}
