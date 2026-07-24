import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import type { ApiQueries } from './queries';

export interface AppOptions {
  corsOrigin: string;
  rateLimitMax?: number;
}

export async function buildApp(queries: ApiQueries, opts: AppOptions): Promise<FastifyInstance> {
  const app = Fastify();

  await app.register(cors, { origin: opts.corsOrigin });
  await app.register(rateLimit, {
    max: opts.rateLimitMax ?? 100,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      error: 'rate_limited',
      message: 'Too many requests, slow down',
    }),
  });

  app.addHook('onSend', async (_req, reply) => {
    if (reply.statusCode === 200) {
      reply.header('cache-control', 'public, max-age=7200');
    }
  });

  app.setNotFoundHandler((_req, reply) => {
    void reply.status(404).send({ error: 'not_found', message: 'Route not found' });
  });

  app.setErrorHandler((err: any, _req, reply) => {
    const status = err?.statusCode ?? 500;
    void reply.status(status).send({
      error: status === 429 ? 'rate_limited' : 'internal_error',
      message: err?.message ?? 'Unknown error',
    });
  });

  app.get('/api/terms', async () => queries.listTerms());

  app.get('/api/terms/:termId/departments', async (req, reply) => {
    const raw = (req.params as { termId: string }).termId;
    const termId = Number(raw);
    if (!Number.isInteger(termId) || !(await queries.termExists(termId))) {
      return reply.status(404).send({ error: 'not_found', message: `Unknown term ${raw}` });
    }
    return queries.listDepartments(termId);
  });

  app.get('/api/terms/:termId/courses', async (req, reply) => {
    const raw = (req.params as { termId: string }).termId;
    const { dept, q } = req.query as { dept?: string; q?: string };
    if (!dept) {
      return reply
        .status(400)
        .send({ error: 'bad_request', message: 'dept query parameter is required' });
    }
    const termId = Number(raw);
    if (!Number.isInteger(termId) || !(await queries.termExists(termId))) {
      return reply.status(404).send({ error: 'not_found', message: `Unknown term ${raw}` });
    }
    return queries.listCourses(termId, dept, q ?? null);
  });

  return app;
}
