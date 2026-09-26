import { Hono } from 'hono';
import { requireAuth, getSession, login, logout } from './auth';
import { recordsApi } from './records';
import { domainApi } from './domain';
import { importsApi } from './imports';
import { syncApi, drainOutbox } from './sync';
import type { Env } from './env';

const app = new Hono<{ Bindings: Env; Variables: { csrfToken: string } }>();
app.use('/api/*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  c.header('X-Content-Type-Options', 'nosniff');
  await next();
});
app.post('/api/auth/login', login);
app.get('/api/auth/session', getSession);
app.use('/api/*', requireAuth);
app.post('/api/auth/logout', logout);
app.route('/api', domainApi);
app.route('/api', recordsApi);
app.route('/api', importsApi);
app.route('/api', syncApi);
app.notFound(c => c.req.path.startsWith('/api/') ? c.json({ error: 'Rota não encontrada' }, 404) : c.env.ASSETS.fetch(c.req.raw));
app.onError((error, c) => {
  console.error(error);
  return c.json({ error: 'Erro interno do servidor' }, 500);
});

export default {
  fetch: app.fetch,
  scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(drainOutbox(env));
  },
};
