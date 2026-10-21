'use client';

import { useId, useState } from 'react';

// The connector's address with Copy (owner, 21 October 2026: "the connection method": pasted into Claude's Add custom
// connector). Without clipboard access, the box is selected for Ctrl+C.

export function CopyAddress({ address }: { address: string }) {
  const id = useId();
  const [copied, setCopied] = useState<'yes' | 'failed' | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied('yes');
    } catch {
      (document.getElementById(id) as HTMLInputElement | null)?.select();
      setCopied('failed');
    }
  }

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="label">
        Remote MCP server URL
      </label>
      <div className="flex flex-wrap gap-2">
        <input id={id} readOnly value={address} onFocus={(e) => e.currentTarget.select()} className="input min-w-0 flex-1 font-mono text-sm" />
        <button type="button" onClick={copy} className="btn btn-primary">
          {copied === 'yes' ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p role="status" className="text-sm text-muted">
        {copied === 'yes' ? 'Copied. Paste it into Claude.' : copied === 'failed' ? 'Press Ctrl+C (⌘C on a Mac) to copy it.' : ''}
      </p>
    </div>
  );
}
