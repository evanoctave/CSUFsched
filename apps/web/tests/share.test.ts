import { describe, it, expect } from 'vitest';
import { encodeShare, decodeShare, parseShareHash, shareUrl } from '../src/lib/share.ts';

const PAYLOAD = {
  termId: 1,
  sectionIds: [2, 5],
  busyBlocks: [{ day: 'Tu' as const, startMin: 600, endMin: 720 }],
};

describe('share codec', () => {
  it('roundtrips through encode/decode', () => {
    expect(decodeShare(encodeShare(PAYLOAD))).toEqual(PAYLOAD);
  });

  it('produces url-safe strings', () => {
    expect(encodeShare(PAYLOAD)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('parseShareHash extracts payload from location hash', () => {
    const url = shareUrl(PAYLOAD, 'http://localhost:5173', '/');
    const hash = new URL(url).hash;
    expect(parseShareHash(hash)).toEqual(PAYLOAD);
  });

  it('returns null on garbage', () => {
    expect(decodeShare('not-base64!!!')).toBeNull();
    expect(parseShareHash('#other')).toBeNull();
    expect(parseShareHash('')).toBeNull();
  });
});
