import { createPool } from '@csufsched/db';
import { makeQueries } from './queries.ts';
import { buildApp } from './app.ts';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Required env: DATABASE_URL');
  process.exit(1);
}
const port = Number(process.env.PORT ?? 3001);
const corsOrigin = process.env.CORS_ORIGIN ?? 'http://localhost:5173';

const pool = createPool(databaseUrl);
const app = await buildApp(makeQueries(pool), { corsOrigin });

try {
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`API listening on :${port}`);
} catch (err) {
  console.error(err);
  process.exit(1);
}
