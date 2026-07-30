import { ENVELOPE_FIELDS } from './forms.ts';
import type { FetchLike } from './rateLimit.ts';

export const DEFAULT_BASE_URL =
  'https://cmsweb.fullerton.edu/psc/CFULPRD/EMPLOYEE/SA/c/SA_LEARNER_SERVICES.CLASS_SEARCH.GBL?public=';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36';

export interface SessionOptions {
  baseUrl: string;
  fetchFn: FetchLike;
}

export interface PeopleSoftSession {
  readonly entryHtml: string;
  post(action: string, fields?: Record<string, string>): Promise<string>;
}

export function isSessionExpired(html: string): boolean {
  return (
    /your session (has (timed out|expired)|is no longer active)/i.test(html) ||
    html.includes('cmd=login') ||
    html.includes('signon.html')
  );
}

function readHiddenField(html: string, name: string): string | null {
  const m = new RegExp(`id='${name}'\\s+value='([^']*)'`).exec(html);
  return m ? m[1] : null;
}

class CookieJar {
  private jar = new Map<string, string>();

  ingest(res: Response): void {
    for (const raw of res.headers.getSetCookie()) {
      const pair = raw.split(';', 1)[0];
      const eq = pair.indexOf('=');
      if (eq > 0) this.jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  header(): string {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

class Session implements PeopleSoftSession {
  entryHtml = '';
  private icsid = '';
  private stateNum = 1;
  private jar = new CookieJar();

  constructor(private readonly opts: SessionOptions) {}

  async open(): Promise<void> {
    const res = await this.opts.fetchFn(this.opts.baseUrl);
    const html = await res.text();
    this.jar.ingest(res);
    const icsid = readHiddenField(html, 'ICSID');
    if (icsid === null) throw new Error('entry page carried no ICSID');
    this.icsid = icsid;
    this.stateNum = Number(readHiddenField(html, 'ICStateNum') ?? '1');
    this.entryHtml = html;
  }

  async post(action: string, fields: Record<string, string> = {}): Promise<string> {
    const html = await this.send(action, fields);
    if (!isSessionExpired(html)) return html;

    await this.open();
    const retry = await this.send(action, fields);
    if (isSessionExpired(retry)) throw new Error(`session expired twice on action ${action}`);
    return retry;
  }

  private async send(action: string, fields: Record<string, string>): Promise<string> {
    const body = new URLSearchParams({
      ...ENVELOPE_FIELDS,
      ICSID: this.icsid,
      ICStateNum: String(this.stateNum),
      ICAction: action,
      ...fields,
    });
    const res = await this.opts.fetchFn(this.opts.baseUrl, {
      method: 'POST',
      body,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: this.jar.header(),
        'user-agent': USER_AGENT,
      },
    });
    const html = await res.text();
    this.jar.ingest(res);
    const echoed = readHiddenField(html, 'ICStateNum');
    this.stateNum = echoed === null ? this.stateNum + 1 : Number(echoed);
    return html;
  }
}

export async function openSession(opts: SessionOptions): Promise<PeopleSoftSession> {
  const session = new Session(opts);
  await session.open();
  return session;
}
