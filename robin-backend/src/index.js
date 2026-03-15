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
        if (origin.endsWith('.vercel.app')) return cb(null, true);
        if (origin.endsWith('.render.com')) return cb(null, true);
        cb(new Error(`CORS blocked: ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(defaultLimiter);

// ── Health Check ─────────────────────────────────────────────
app.get('/health', (_req, res) =>
    res.json({ status: 'ok', timestamp: new Date().toISOString(), service: 'robin-backend' })
);

// ── Dev Dashboard (HTML pages only in development) ───────────
if (!config.isProduction) {
    app.get('/dashboard', (_req, res) => res.sendFile(path.join(__dirname, '..', 'test-dashboard.html')));
    app.get('/test-dashboard.html', (_req, res) => res.sendFile(path.join(__dirname, '..', 'test-dashboard.html')));
}

// ── Dev-test API routes (serve frontend data — always mounted) ──
{
    const { default: devTestRouter } = await import('./routes/dev-test.js');
    app.use('/api/test', devTestRouter);
    log.system.info('Dev-test routes mounted at /api/test');
    if (config.isProduction) {
        log.system.warn('WARNING: Dev-test routes mounted in production — migrate to authenticated routes');
    }
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

// ── System Health (SUPER_ADMIN) ──────────────────────────────
app.get('/api/admin/system-health', authenticate, requireRole('SUPER_ADMIN'), async (req, res) => {
    try {
        const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
        const dayAgo = new Date(Date.now() - 86400000).toISOString();

        const [lockRes, srcRes, a24hRes, totalRes, pendingRes, failRes, completeRes, clientsRes] = await Promise.all([
            supabase.from('system_state').select('value, updated_at').eq('key', 'scraper_running').single(),
            supabase.from('sources').select('id', { count: 'exact', head: true }).eq('is_active', true),
            supabase.from('articles').select('id', { count: 'exact', head: true }).gte('created_at', dayAgo),
            supabase.from('articles').select('id', { count: 'exact', head: true }),
            supabase.from('articles').select('id', { count: 'exact', head: true }).eq('analysis_status', 'pending').lt('created_at', oneHourAgo),
            supabase.from('articles').select('id', { count: 'exact', head: true }).eq('analysis_status', 'failed').gte('created_at', dayAgo),
            supabase.from('articles').select('id', { count: 'exact', head: true }).eq('analysis_status', 'complete').gte('created_at', dayAgo),
            supabase.from('clients').select('id', { count: 'exact', head: true }),
        ]);

        const complete = completeRes.count || 0;
        const failed = failRes.count || 0;
        const completion = (complete + failed) > 0 ? Math.round(complete / (complete + failed) * 100) : 100;
        const pending = pendingRes.count || 0;
        const articles24h = a24hRes.count || 0;
        const sources = srcRes.count || 0;

        const status = (pending > 100 || (sources > 0 && articles24h === 0))
            ? 'critical'
            : (pending > 20 || completion < 90)
                ? 'degraded'
                : 'healthy';

        res.json({
            status,
            checked_at: new Date().toISOString(),
            scraper: {
                last_run: lockRes.data?.updated_at || null,
                is_locked: lockRes.data?.value === 'true',
                sources_total: sources,
                articles_last_24h: articles24h,
            },
            ai_pipeline: {
                pending_articles: pending,
                failed_articles_24h: failed,
                completion_rate_pct: completion,
            },
            database: {
                total_articles: totalRes.count || 0,
                total_clients: clientsRes.count || 0,
            },
        });
    } catch (err) {
        log.system.error('System health check failed', { error: err.message });
        res.status(500).json({ error: 'Health check failed' });
    }
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

    startScheduler();
    startAnalysisWorker();
});

// ── Graceful Shutdown ────────────────────────────────────────
process.on('SIGTERM', () => {
    log.system.info('SIGTERM received — shutting down gracefully');
    server.close(() => { log.system.info('Server closed'); process.exit(0); });
    setTimeout(() => { log.system.warn('Forced shutdown after 10s'); process.exit(1); }, 10000);
});

export default app;
