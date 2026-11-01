'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ASSET_PATHS } from '@/lib/asset-paths';
import { claudeRegisterHref, claudeRegisterPrompt } from '@/lib/claude-register';

// "Register with Claude" on the Add form (owner, 21 October 2026: "add register with claude"), on the site and in the app:
// Claude opens with the instruction ready (and it is copied too, should Claude open without it); the photos are attached
// and read there, Claude drafts the asset through the connector, and the person comes back to Drafts From Claude to add
// the photos and save. A plain link, so the app hands it to the phone (the Claude app or the browser).

export function RegisterWithClaude() {
  const [copied, setCopied] = useState(false);

  function copy() {
    try {
      void navigator.clipboard
        ?.writeText(claudeRegisterPrompt())
        .then(() => setCopied(true))
        .catch(() => undefined);
    } catch {
      // no clipboard here: the instruction is in the link
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-dashed border-line p-4">
      <div className="flex flex-wrap items-center gap-3">
        <a href={claudeRegisterHref()} target="_blank" rel="noopener noreferrer" onClick={copy} className="btn btn-secondary min-h-11">
          Register with Claude
        </a>
        <Link href={ASSET_PATHS.drafts} className="text-sm font-semibold">
          Drafts From Claude
        </Link>
        <Link href={ASSET_PATHS.connectClaude} className="text-sm font-semibold">
          Connect Claude
        </Link>
      </div>
      {copied && (
        <p role="status" className="text-xs text-muted">
          Instruction copied.
        </p>
      )}
    </div>
  );
}
