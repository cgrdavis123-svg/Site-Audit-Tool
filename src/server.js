import crypto from 'node:crypto';
import path from 'node:path';
import express from 'express';

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

function timingSafeEqualStrings(a, b) {
  const bufA = Buffer.from(String(a ?? ''));
  const bufB = Buffer.from(String(b ?? ''));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Build the dashboard's Express app: a static single-page UI, a small
 * JSON API for creating/listing/inspecting audit jobs, and static
 * serving of generated reports. When `token` is set, everything except
 * the login page and the login endpoint requires a matching cookie or
 * `X-Dashboard-Token` header — this is a deliberately lightweight gate,
 * not a full auth system, appropriate for a small internal tool that
 * lets any caller point your server at an arbitrary URL and crawl it.
 */
export function createApp({ jobManager, publicDir, reportsDir, token = null }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  function isAuthed(req) {
    if (!token) return true;
    const cookies = parseCookies(req.headers.cookie);
    const provided = cookies.dashboard_token || req.headers['x-dashboard-token'];
    return provided ? timingSafeEqualStrings(provided, token) : false;
  }

  function requireAuth(req, res, next) {
    if (isAuthed(req)) return next();
    res.status(401).json({ error: 'Unauthorized' });
  }

  app.use(express.static(publicDir, { index: false }));

  app.get('/', (req, res) => {
    const page = token && !isAuthed(req) ? 'login.html' : 'dashboard.html';
    res.sendFile(path.join(publicDir, page));
  });

  app.post('/api/login', (req, res) => {
    if (!token) return res.json({ ok: true });
    const provided = req.body?.token;
    if (!timingSafeEqualStrings(provided, token)) {
      return res.status(401).json({ error: 'Incorrect token.' });
    }
    const maxAgeSeconds = 30 * 24 * 3600;
    const secure = req.protocol === 'https' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `dashboard_token=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax${secure}`);
    res.json({ ok: true });
  });

  app.post('/api/logout', (req, res) => {
    res.setHeader('Set-Cookie', 'dashboard_token=; HttpOnly; Path=/; Max-Age=0');
    res.json({ ok: true });
  });

  app.get('/api/auth-status', (req, res) => {
    res.json({ required: !!token, authenticated: isAuthed(req) });
  });

  app.use('/reports', requireAuth, express.static(reportsDir, { index: false }));

  const api = express.Router();
  api.use(requireAuth);

  api.get('/audits', (req, res) => {
    res.json(jobManager.list());
  });

  api.post('/audits', (req, res) => {
    const { url, ...options } = req.body || {};
    const job = jobManager.createJob({ url, options });
    res.status(201).json(job);
  });

  api.get('/audits/:id', (req, res) => {
    const job = jobManager.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Audit job not found.' });
    res.json(job);
  });

  api.delete('/audits/:id', (req, res) => {
    jobManager.deleteJob(req.params.id);
    res.json({ ok: true });
  });

  app.use('/api', api);

  app.use((req, res) => res.status(404).json({ error: 'Not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.statusCode || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.message || 'Internal server error' });
  });

  return app;
}
