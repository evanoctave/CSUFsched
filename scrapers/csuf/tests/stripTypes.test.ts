import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';

const run = promisify(execFile);
const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.ts');

describe('strip-types compatibility', () => {
  // The cron jobs run these sources through `node --experimental-strip-types`,
  // which rejects parameter properties, enums, namespaces and decorators.
  // Vitest transpiles with esbuild and accepts all of them, so only a real
  // import under Node catches the difference. `--check` does not: it parses
  // without applying the strip-only restrictions.
  it('imports the package entrypoint under node --experimental-strip-types', async () => {
    await run(process.execPath, ['--experimental-strip-types', '-e', `import(${JSON.stringify(entry)})`]);
  }, 30_000);
});
