import { useState } from 'react';
import { useScheduleStore, placedSections } from '../store.ts';
import { shareUrl } from '../lib/share.ts';
import { buildIcs } from '../lib/ics.ts';

export function ShareBar() {
  const termId = useScheduleStore((s) => s.termId);
  const placedSectionIds = useScheduleStore((s) => s.placedSectionIds);
  const busyBlocks = useScheduleStore((s) => s.busyBlocks);
  const catalog = useScheduleStore((s) => s.catalog);
  const [copied, setCopied] = useState(false);

  if (termId === null) return null;

  const url = shareUrl(
    { termId, sectionIds: placedSectionIds, busyBlocks },
    window.location.origin,
    window.location.pathname,
  );

  const copy = (e: React.MouseEvent) => {
    e.preventDefault();
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const exportIcs = () => {
    const entries = placedSections({ catalog, placedSectionIds });
    const blob = new Blob([buildIcs(entries)], { type: 'text/calendar' });
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = 'schedule.ics';
    a.click();
    URL.revokeObjectURL(objectUrl);
  };

  return (
    <div className="flex items-center gap-2">
      <a
        data-testid="share-link"
        href={url}
        onClick={copy}
        className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white transition hover:bg-ink/85 active:scale-[0.97]"
      >
        Copy share link
      </a>
      {copied && (
        <span role="status" className="animate-pop text-sm font-medium text-emerald-700">
          Copied!
        </span>
      )}
      <button
        type="button"
        onClick={exportIcs}
        disabled={placedSectionIds.length === 0}
        className="rounded-lg border bg-white px-3 py-1.5 text-sm font-medium transition hover:border-ink/40 active:scale-[0.97] disabled:opacity-45 disabled:active:scale-100"
      >
        Export .ics
      </button>
    </div>
  );
}
