import Fastify, { type FastifyInstance, type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import type { ApiQueries } from './queries.ts';

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
  });

  app.addHook('onSend', async (_req, reply) => {
    if (reply.statusCode === 200) {
      reply.header('cache-control', 'public, max-age=7200');
    }
  });

  app.setNotFoundHandler((_req, reply) => {
    void reply.status(404).send({ error: 'not_found', message: 'Route not found' });
  });

  app.setErrorHandler((err: FastifyError, _req, reply) => {
    const status = err.statusCode ?? 500;
    void reply.status(status).send(
      status === 429
        ? { error: 'rate_limited', message: 'Too many requests, slow down' }
        : { error: 'internal_error', message: err.message },
    );
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

  app.get('/api/professors/:id', async (req, reply) => {
    const raw = (req.params as { id: string }).id;
    const id = Number(raw);
    const detail = Number.isInteger(id) ? await queries.getProfessorDetail(id) : null;
    if (detail === null) {
      return reply.status(404).send({ error: 'not_found', message: `Unknown professor ${raw}` });
    }
    return detail;
  });

  app.get('/api/sections', async (req, reply) => {
    const raw = (req.query as { ids?: string }).ids;
    // Number('') === 0, so blank segments must be mapped to NaN explicitly
    const ids =
      raw === undefined
        ? []
        : [...new Set(raw.split(',').map((s) => (s.trim() === '' ? NaN : Number(s))))];
    if (raw === undefined || ids.length === 0 || ids.some((n) => !Number.isInteger(n))) {
      return reply.status(400).send({
        error: 'bad_request',
        message: 'ids query parameter is required, e.g. ids=1,2,3',
      });
    }
    const result = await queries.listSectionsByIds(ids);
    if (result === null) {
      return reply.status(404).send({ error: 'not_found', message: 'One or more sections not found' });
    }
    return result;
  });

  return app;
}
