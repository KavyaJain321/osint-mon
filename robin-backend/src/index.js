// ============================================================
// ROBIN OSINT — Express Server Entry Point
// Wires routes, middleware, scheduler, and analysis worker
// ============================================================

import { config } from './config.js';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { defaultLimiter } from './middleware/rateLimiter.js';
import { log } from './lib/logger.js';

// Route imports — public
import authRouter from './routes/auth.js';

// Route imports — authenticated
import articlesRouter from './routes/articles.js';
import analyticsRouter from './routes/analytics.js';
import sourcesRouter from './routes/sources.js';
import keywordsRouter from './routes/keywords.js';
import usersRouter from './routes/users.js';
import clientsRouter from './routes/clients.js';
import chatRouter from './routes/chat.js';
import reportsRouter from './routes/reports.js';
import briefRouter from './routes/brief.js';
import adminRouter from './routes/admin.js';

// System imports
import { startScheduler } from './scheduler/cron.js';
import { startAnalysisWorker } from './ai/analysis-worker.js';
import { loadPipelineProgress } from './lib/pipeline-tracker.js';
import { startQueuePoller } from './services/video-processor/video-queue.js';
import { supabase } from './lib/supabase.js';
import { authenticate } from './middleware/auth.js';
import { requireRole } from './middleware/roleCheck.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

// ── Middleware ───────────────────────────────────────────────
app.set('trust proxy', 1); // Required on Render (behind reverse proxy) for rate limiting
app.use(helmet({ contentSecurityPolicy: false }));

const allowedOrigins = [
    config.frontendUrl,
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:3001',
].filter(Boolean);

app.use(cors({
    origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        if (allowedOrigins.includes(origin)) return cb(null, true);
        // Better regex for Vercel and Render subdomains
        if (/\.vercel\.app$/.test(origin)) return cb(null, true);
        if (/\.onrender\.com$/.test(origin)) return cb(null, true);
        cb(new Error(`CORS blocked: ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(defaultLimiter);

// ── Health Check ─────────────────────────────────────────────
app.get('/health', async (_req, res) => {
    const health = {
        status:    'ok',
        timestamp: new Date().toISOString(),
        service:   'robin-backend',
        integrations: {},
    };
    // Return health status
    res.status(health.status === 'ok' ? 200 : 503).json(health);
});

// ── Ping (keep-alive for cron-job.org — minimal response to stay under 16KB limit) ──
app.get('/ping', (_req, res) => res.send('ok'));

// ── Dev Dashboard (HTML pages only in development) ───────────
if (!config.isProduction) {
    app.get('/dashboard', (_req, res) => res.sendFile(path.join(__dirname, '..', 'test-dashboard.html')));
    app.get('/test-dashboard.html', (_req, res) => res.sendFile(path.join(__dirname, '..', 'test-dashboard.html')));
}

// ── Dev-test API routes ──────────────────────────────────────
// BUG FIX #16: These routes were always mounted without authentication, even in
// production, exposing articles, intelligence signals, and chat to anyone.
// In production, gate them behind the standard JWT auth middleware.
{
    const { default: devTestRouter } = await import('./routes/dev-test.js');
    if (config.isProduction) {
        log.system.warn('Dev-test routes are production-gated behind JWT authentication.');
        // Apply auth to the entire /api/test prefix in production
        app.use('/api/test', authenticate, devTestRouter);
    } else {
        // In development: mount without auth for convenience
        app.use('/api/test', devTestRouter);
        log.system.info('Dev-test routes mounted at /api/test (no auth — dev mode)');
    }
}

// ── Video Processing API routes ─────────────────────────────
{
    const { default: videoRouter } = await import('./routes/video.js');
    app.use('/api/test/video', videoRouter);
    log.system.info('Video processing routes mounted at /api/test/video');
}

// ── Public Auth Routes ──────────────────────────────────────
app.use('/api/auth', authRouter);

// ── Authenticated API Routes ─────────────────────────────────
app.use('/api/articles', articlesRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/sources', sourcesRouter);
app.use('/api/keywords', keywordsRouter);
app.use('/api/users', usersRouter);
app.use('/api/clients', clientsRouter);
app.use('/api/chat', chatRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/briefs', briefRouter);   // Phase 1: problem intake pipeline
app.use('/api/admin', adminRouter);   // Phase 1: SUPER_ADMIN console

// BUG FIX #19: Removed the duplicate /api/admin/system-health definition that
// lived here in index.js. It was applying authenticate + requireRole a SECOND
// time after the admin router had already run them. The endpoint now lives
// exclusively in src/routes/admin.js where it belongs.

// ── 404 Handler ──────────────────────────────────────────────
// BUG FIX #37: No 404 handler existed — unmatched routes fell through to the
// error handler and returned a generic 500. Now returns a proper 404 JSON response.
app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// ── Global Error Handler ─────────────────────────────────────
app.use((err, req, res, _next) => {
    log.system.error('Unhandled error', { method: req.method, path: req.path, error: err.message });
    res.status(err.status || 500).json({
        error: 'Internal server error',
        ...(config.isProduction ? {} : { message: err.message }),
    });
});

// ── Start Server ─────────────────────────────────────────────
const server = app.listen(config.port, async () => {
    log.system.info(`ROBIN OSINT backend on port ${config.port} [${config.nodeEnv}]`);

    // Clear any stale locks left over from a crash or Render restart.
    // Without this, the scraper and batch intelligence would be permanently
    // blocked (up to 30min / 3h) after every unexpected restart.
    try {
        await supabase.from('system_state').upsert([
            { key: 'scraper_running', value: 'false', updated_at: new Date().toISOString() },
            { key: 'batch_intelligence_lock', value: 'false', updated_at: new Date().toISOString() },
        ]);
        log.system.info('Startup: stale scraper/batch locks cleared');
    } catch (e) {
        log.system.warn('Startup: could not clear locks (system_state may not exist yet)', { error: e.message });
    }

    await loadPipelineProgress();
    log.system.info('Pipeline progress restored from DB');

    // Single-process deploy: run everything here.
    // The DB-driven video queue poller picks up any videos stuck in
    // 'queued' state after a restart (Render free-tier spin-down safe).
    startScheduler();
    startAnalysisWorker();
    startQueuePoller();
});

// ── Graceful Shutdown ────────────────────────────────────────
process.on('SIGTERM', () => {
    log.system.info('SIGTERM received — shutting down gracefully');
    server.close(() => { log.system.info('Server closed'); process.exit(0); });
    setTimeout(() => { log.system.warn('Forced shutdown after 10s'); process.exit(1); }, 10000);
});

export default app;
