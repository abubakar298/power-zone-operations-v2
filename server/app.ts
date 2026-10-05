import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import type { Pool } from 'pg';
import { resolve } from 'node:path';
import type { Config } from './config.js';
import { AuthRepository } from './auth/repository.js';
import { AuthService } from './auth/service.js';
import { authHttp } from './auth/http.js';
import { dashboardRoutes } from './dashboard/routes.js';
import { HttpError } from './http/errors.js';

export function createApp(pool: Pool, config: Config, webDirectory?: string) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxyHops);
  app.use(helmet({ strictTransportSecurity: config.production ? undefined : false }));
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use('/api', (req, _res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      if (req.get('Origin') !== config.origin) throw new HttpError(403, 'This request origin is not allowed.');
      if (!req.is('application/json')) throw new HttpError(415, 'JSON request required.');
    }
    next();
  });
  app.use(express.json({ limit: '8kb' }));
  app.get('/api/health', async (_req, res) => {
    try {
      await pool.query('SELECT singleton FROM admin_bootstrap LIMIT 1');
      res.json({ status: 'ok' });
    } catch { res.status(503).json({ status: 'unavailable' }); }
  });
  const auth = authHttp(new AuthService(new AuthRepository(pool), config), config);
  app.use('/api/auth', auth.router);
  app.use('/api/dashboard', dashboardRoutes(auth.requireSession));
  app.use('/api', (_req, res) => { res.status(404).json({ message: 'Endpoint not found.' }); });
  if (webDirectory) {
    app.use(express.static(webDirectory, { index: false, maxAge: '1h' }));
    app.get('/{*path}', (_req, res) => { res.set('Cache-Control', 'no-store').sendFile(resolve(webDirectory, 'index.html')); });
  }
  const errors: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
    if (err instanceof HttpError) {
      if (err.status === 429) res.set('Retry-After', '900');
      res.status(err.status).json({ message: err.message });
    } else if (err instanceof SyntaxError) {
      res.status(400).json({ message: 'Invalid JSON request.' });
    } else if (typeof err === 'object' && err && 'type' in err && err.type === 'entity.too.large') {
      res.status(413).json({ message: 'Request is too large.' });
    } else {
      // Do not emit request bodies, database URLs, tokens or SQL parameter values.
      console.error('Request failed', err instanceof Error ? err.name : 'UnknownError');
      res.status(503).json({ message: 'Service temporarily unavailable. Please try again.' });
    }
  };
  app.use(errors);
  return app;
}
