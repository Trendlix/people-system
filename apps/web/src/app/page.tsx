import { connection } from "next/server";
import { Suspense } from "react";

const API_URL = process.env.API_URL ?? "http://localhost:3001";

async function SystemStatus() {
  await connection();
  let ok = false;
  try {
    const res = await fetch(`${API_URL}/api/health`);
    ok = res.ok;
  } catch {
    ok = false;
  }
  return ok ? (
    <p className="mt-6 text-emerald-700 dark:text-emerald-400">API and database: connected</p>
  ) : (
    <p className="mt-6 text-amber-700 dark:text-amber-400">API not reachable at {API_URL}</p>
  );
}

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-xl px-4 py-16">
      <h1 className="text-2xl font-semibold">TrendLIX Management System</h1>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">
        Project skeleton. Modules are added one at a time.
      </p>
      <Suspense fallback={<p className="mt-6">Checking API…</p>}>
        <SystemStatus />
      </Suspense>
    </main>
  );
}
