'use client';

import { roomPath } from '@planning-poker/shared';
import { useEffect, useState } from 'react';

/** PRD §4 step 3: the host copies this and pastes it into Slack/Teams. */
export function InviteLink({ code }: { code: string }) {
  const [url, setUrl] = useState('');
  const [copied, setCopied] = useState(false);

  // The origin is only known in the browser, and it differs between dev, e2e and the EC2 host.
  useEffect(() => {
    setUrl(`${window.location.origin}${roomPath(code)}`);
  }, [code]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard access can be denied (insecure origin, permissions); the field is selectable.
      setCopied(false);
    }
  }

  return (
    <section aria-labelledby="invite-heading" className="space-y-2">
      <h2
        id="invite-heading"
        className="text-sm font-semibold uppercase tracking-wide text-slate-400"
      >
        Link mời
      </h2>
      <div className="flex flex-wrap gap-2">
        <input
          readOnly
          value={url}
          aria-label="Link mời vào phòng"
          data-testid="invite-link"
          className="w-full min-w-0 flex-1 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 font-mono text-sm text-slate-300"
        />
        <button
          type="button"
          onClick={() => void copy()}
          data-testid="invite-copy"
          className="shrink-0 rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-slate-800"
        >
          {copied ? 'Đã copy' : 'Copy'}
        </button>
      </div>
    </section>
  );
}
