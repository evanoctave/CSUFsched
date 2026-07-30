export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function rateLimited<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
  minIntervalMs: number,
): (...args: A) => Promise<R> {
  let chain: Promise<unknown> = Promise.resolve();
  return (...args: A): Promise<R> => {
    const result = chain.then(() => fn(...args));
    chain = result.catch(() => undefined).then(() => sleep(minIntervalMs));
    return result;
  };
}

export interface BackoffOptions {
  retries: number;
  baseDelayMs: number;
}

export async function fetchWithBackoff(
  url: string,
  fetchFn: FetchLike,
  opts: BackoffOptions,
  init?: RequestInit,
): Promise<Response> {
  let attempt = 0;
  for (;;) {
    const res = await fetchFn(url, init);
    // Redirects belong to the caller: Session fetches with `redirect: 'manual'`
    // so it can carry the cookie jar across hops itself.
    if (res.ok || (res.status >= 300 && res.status < 400)) return res;
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= opts.retries) {
      throw new Error(`fetch failed: ${res.status} ${url}`);
    }
    await sleep(opts.baseDelayMs * 2 ** attempt);
    attempt += 1;
  }
}
