import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="text-center">
        <h1 className="text-xl font-semibold">Page Not Found</h1>
        <Link href="/" className="btn btn-secondary mt-6">
          Go to home
        </Link>
      </div>
    </main>
  );
}
