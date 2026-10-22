import { MODE_CHOICE_TITLE, type ModeChoice } from '@trendlix/shared';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { Brand, BrandFallback, brandMetadata } from '@/components/brand';
import { PushTokenField } from '@/components/push-token-field';
import { logout } from '@/app/login/actions';
import { apiGet } from '@/lib/api';
import { getCurrentUser } from '@/lib/session';
import { modeCards } from '@/lib/session-mode';
import { ModeChoiceForm } from './mode-choice-form';

// After the password, a developer who is also an employee chooses how to use the system (owner, 22 October 2026: "when a
// developer signin, give hin a switched to use the account as the main role assigned to him or as a developer, to not
// confuse him"): As yourself (their own roles, their own real data) or As a developer (read only, pseudonyms), the last
// choice pre-selected. Until they choose, every other page sends them back here (components/mode-gate.tsx). Anyone else,
// someone who has chosen, and the app (always as themselves) go to their home page.

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'Choose How to Use the System · People System', ...(await brandMetadata()) };
}

async function Choice() {
  const [user, choice] = await Promise.all([getCurrentUser(), apiGet<ModeChoice>('/auth/mode')]);
  if (!choice.chooses || choice.mode !== null) redirect(user.session?.kind === 'app' ? '/app' : '/');
  const { cards, selected } = modeCards(choice);
  return <ModeChoiceForm cards={cards} selected={selected} />;
}

export default function ChooseModePage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg">
        <div className="mb-8">
          <Suspense fallback={<BrandFallback />}>
            <Brand />
          </Suspense>
        </div>
        <div className="card p-6">
          <h1 className="mb-6 text-xl font-semibold">{MODE_CHOICE_TITLE}</h1>
          <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
            <Choice />
          </Suspense>
          <form action={logout} className="mt-4 text-center">
            <PushTokenField />
            <button type="submit" className="cursor-pointer text-sm text-muted underline hover:text-ink">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
