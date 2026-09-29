'use client';

import { roomPath } from '@planning-poker/shared';
import { useEffect, useState } from 'react';

/** PRD §4 step 3: the host copies this and pastes it into Slack/Teams.
 * Compact by design — it lives in the room screen's single header row. */
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
    <section aria-labelledby="invite-heading" className="flex min-w-0 items-center gap-2">
      <h2 id="invite-heading" className="sr-only">
        Link mời
      </h2>
      <input
        readOnly
        value={url}
        aria-label="Link mời vào phòng"
        data-testid="invite-link"
        className="min-w-0 flex-1 rounded-lg border border-line bg-surface-2 px-2 py-1 font-mono text-xs text-ink-muted"
      />
      <button
        type="button"
        onClick={() => void copy()}
        data-testid="invite-copy"
        className="shrink-0 rounded-lg border border-line-strong px-3 py-1 text-xs font-semibold text-ink hover:bg-surface-2"
      >
        {copied ? 'Đã copy' : 'Copy'}
      </button>
    </section>
  );
}
