import type { TimeBlock } from '@csufsched/types';

export interface SharePayload {
  termId: number;
  sectionIds: number[];
  busyBlocks: TimeBlock[];
}

export function encodeShare(p: SharePayload): string {
  const json = JSON.stringify({ t: p.termId, s: p.sectionIds, b: p.busyBlocks });
  return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeShare(encoded: string): SharePayload | null {
  try {
    const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const raw = JSON.parse(atob(b64)) as { t: unknown; s: unknown; b: unknown };
    if (typeof raw.t !== 'number' || !Array.isArray(raw.s) || !Array.isArray(raw.b)) return null;
    return { termId: raw.t, sectionIds: raw.s as number[], busyBlocks: raw.b as TimeBlock[] };
  } catch {
    return null;
  }
}

export function shareUrl(p: SharePayload, origin: string, pathname: string): string {
  return `${origin}${pathname}#s=${encodeShare(p)}`;
}

export function parseShareHash(hash: string): SharePayload | null {
  const m = /^#s=(.+)$/.exec(hash);
  return m ? decodeShare(m[1]) : null;
}
