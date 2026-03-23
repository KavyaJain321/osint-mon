// ============================================================
// Admin Routes — SUPER_ADMIN only
// Brief review + approval, client management, system health
// ============================================================

import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { log } from '../lib/logger.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roleCheck.js';
import { runScraperCycle } from '../scrapers/orchestrator.js';

// ── System Health ───────────────────────────────────────────

// GET /api/admin/system-health — overall platform health
// BUG FIX #19: Moved here from index.js so it lives inside the admin router
// and only runs authenticate + requireRole once (the router-level middleware).
async function systemHealthHandler(req, res) {
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
}

const router = Router();

// All admin routes require SUPER_ADMIN
router.use(authenticate, requireRole('SUPER_ADMIN'));

// Register the system-health handler (defined above)
router.get('/system-health', systemHealthHandler);

// ── Clients ────────────────────────────────────────────────

// GET /api/admin/clients — all clients with article/signal counts
router.get('/clients', async (req, res) => {
    try {
        const { data: clients, error } = await supabase
            .from('clients')
            .select('id, name, industry, is_active, created_at')
            .order('created_at', { ascending: false });

        if (error) throw error;

        // Enrich with counts
        const enriched = await Promise.all((clients || []).map(async (c) => {
            const [artRes, signalRes, briefRes] = await Promise.all([
                supabase.from('articles').select('id', { count: 'exact', head: true }).eq('client_id', c.id),
                supabase.from('intelligence_signals').select('id', { count: 'exact', head: true }).eq('client_id', c.id).eq('is_acknowledged', false),
                supabase.from('client_briefs').select('status').eq('client_id', c.id).order('created_at', { ascending: false }).limit(1).single(),
            ]);
            return {
                ...c,
                total_articles: artRes.count || 0,
                active_signals: signalRes.count || 0,
                brief_status: briefRes.data?.status || 'none',
            };
        }));

        res.json({ data: enriched });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/admin/clients — create a new client
router.post('/clients', async (req, res) => {
    try {
        const { name, industry } = req.body;
        if (!name) return res.status(400).json({ error: 'name is required' });

        const { data, error } = await supabase
            .from('clients')
            .insert({ name, industry, is_active: true })
            .select().single();

        if (error) throw error;
        log.system.info('Admin created client', { clientId: data.id, name });
        res.json({ data, message: 'Client created' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Brief Review ───────────────────────────────────────────

// GET /api/admin/briefs — all briefs pending review
router.get('/briefs', async (req, res) => {
    try {
        const { status } = req.query; // optional filter: pending_review|approved|active
        let q = supabase
            .from('client_briefs')
            .select('id, title, client_id, status, industry, risk_domains, created_at')
            .order('created_at', { ascending: false });

        if (status) q = q.eq('status', status);

        const { data, error } = await q;
        if (error) throw error;
        res.json({ data: data || [] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PATCH /api/admin/briefs/:id/keywords — bulk approve/reject keywords
router.patch('/briefs/:id/keywords', async (req, res) => {
    try {
        const { id } = req.params;
        const { approved_ids = [], rejected_ids = [] } = req.body;

        const ops = [];
        if (approved_ids.length) {
            ops.push(supabase.from('brief_generated_keywords')
                .update({ approved: true, rejected: false })
                .in('id', approved_ids).eq('brief_id', id));
        }
        if (rejected_ids.length) {
            ops.push(supabase.from('brief_generated_keywords')
                .update({ rejected: true, approved: false })
                .in('id', rejected_ids).eq('brief_id', id));
        }

        await Promise.all(ops);
        log.system.info('Admin reviewed keywords', { briefId: id, approved: approved_ids.length, rejected: rejected_ids.length });
        res.json({ message: `${approved_ids.length} keywords approved, ${rejected_ids.length} rejected` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PATCH /api/admin/briefs/:id/sources — bulk approve/reject sources
router.patch('/briefs/:id/sources', async (req, res) => {
    try {
        const { id } = req.params;
        const { approved_ids = [], rejected_ids = [] } = req.body;

        const ops = [];
        if (approved_ids.length) {
            ops.push(supabase.from('brief_recommended_sources')
                .update({ approved: true, rejected: false })
                .in('id', approved_ids).eq('brief_id', id));
        }
        if (rejected_ids.length) {
            ops.push(supabase.from('brief_recommended_sources')
                .update({ rejected: true, approved: false })
                .in('id', rejected_ids).eq('brief_id', id));
        }

        await Promise.all(ops);
        res.json({ message: `${approved_ids.length} sources approved, ${rejected_ids.length} rejected` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/admin/briefs/:id/activate — push approved items to active client
router.post('/briefs/:id/activate', async (req, res) => {
    try {
        const { id } = req.params;

        // Fetch the brief and check for approved items
        const { data: brief, error: briefErr } = await supabase
            .from('client_briefs').select('*').eq('id', id).single();
        if (briefErr || !brief) return res.status(404).json({ error: 'Brief not found' });

        const [kwRes, srcRes] = await Promise.all([
            supabase.from('brief_generated_keywords').select('*').eq('brief_id', id).eq('approved', true),
            supabase.from('brief_recommended_sources').select('*').eq('brief_id', id).eq('approved', true),
        ]);

        const approvedKws = kwRes.data || [];
        const approvedSrcs = srcRes.data || [];

        if (approvedKws.length === 0 && approvedSrcs.length === 0) {
            return res.status(400).json({ error: 'No approved keywords or sources to activate' });
        }

        // Keywords are already in brief_generated_keywords — scraper reads from there directly
        // No need to copy to watch_keywords anymore

        // Insert approved sources into sources table
        if (approvedSrcs.length > 0) {
            await supabase.from('sources').insert(
                approvedSrcs.map(s => ({
                    client_id: brief.client_id,
                    name: s.name,
                    url: s.url,
                    source_type: s.source_type,
                    is_active: true,
                }))
            );
        }

        // Mark brief as active
        await supabase.from('client_briefs').update({
            status: 'active',
            activated_at: new Date().toISOString(),
        }).eq('id', id);

        log.system.info('Brief activated', {
            briefId: id,
            clientId: brief.client_id,
            keywords: approvedKws.length,
            sources: approvedSrcs.length,
        });

        res.json({
            message: 'Brief activated. Keywords and sources are now live.',
            keywords_added: approvedKws.length,
            sources_added: approvedSrcs.length,
        });
    } catch (err) {
        log.system.error('Brief activation failed', { error: err.message });
        res.status(500).json({ error: err.message });
    }
});

// ── Source Quality ─────────────────────────────────────────

// GET /api/admin/source-quality — ranked source reliability scores
// BUG FIX #5: The `source_reliability` table does not exist in the schema.
// Replaced with a query against the actual `sources` table, computing a
// simple reliability ratio from existing scrape_success_count / scrape_fail_count.
router.get('/source-quality', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('sources')
            .select('id, name, url, source_type, client_id, is_active, last_scraped_at, scrape_success_count, scrape_fail_count, last_scrape_error')
            .order('scrape_success_count', { ascending: false });

        if (error) throw error;

        const enriched = (data || []).map(s => {
            const total = (s.scrape_success_count || 0) + (s.scrape_fail_count || 0);
            const reliability_score = total > 0
                ? Math.round((s.scrape_success_count / total) * 100)
                : null;
            return { ...s, reliability_score, total_scrapes: total };
        });

        res.json({ data: enriched });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Batch Title Translation Migration ─────────────────────

// POST /api/admin/migrate/translate-titles
// One-time migration: translate all existing article titles that lack title_en
// Runs in background — returns immediately with count. Check logs for progress.
router.post('/migrate/translate-titles', async (req, res) => {
    try {
        // Count how many need translating
        const { count } = await supabase
            .from('articles')
            .select('id', { count: 'exact', head: true })
            .is('title_en', null);

        res.json({
            message: `Translation started for up to ${count} articles. Running in background — check server logs for progress.`,
            total_to_translate: count,
        });

        // Run in background (fire and forget)
        runTitleTranslationMigration().catch(e =>
            log.ai.error('[TRANSLATE-MIGRATION] Fatal error', { error: e.message })
        );
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

async function runTitleTranslationMigration() {
    const { groqChat } = await import('../lib/groq.js');
    const BATCH_SIZE = 20;
    let offset = 0;
    let totalDone = 0;

    log.ai.info('[TRANSLATE-MIGRATION] Starting batch title translation...');

    while (true) {
        // Fetch batch of articles without title_en
        const { data: articles, error } = await supabase
            .from('articles')
            .select('id, title')
            .is('title_en', null)
            .not('title', 'is', null)
            .range(offset, offset + BATCH_SIZE - 1);

        if (error) {
            log.ai.error('[TRANSLATE-MIGRATION] DB fetch failed', { error: error.message });
            break;
        }
        if (!articles || articles.length === 0) break;

        // Filter: only translate titles containing non-ASCII (Odia/Hindi chars)
        // English-only titles get copied as-is without an API call
        const needsTranslation = articles.filter(a =>
            /[\u0B00-\u0B7F\u0900-\u097F]/.test(a.title)
        );
        const alreadyEnglish = articles.filter(a =>
            !/[\u0B00-\u0B7F\u0900-\u097F]/.test(a.title)
        );

        // Copy English titles directly (no API call needed)
        for (const a of alreadyEnglish) {
            await supabase.from('articles').update({ title_en: a.title }).eq('id', a.id);
            totalDone++;
        }

        // Batch translate non-English titles
        if (needsTranslation.length > 0) {
            try {
                const wordList = needsTranslation.map((a, i) => `${i + 1}. ${a.title}`).join('\n');
                const response = await groqChat([
                    {
                        role: 'system',
                        content: 'You are a translator. Translate each numbered title to English. Return ONLY a JSON array of strings in the exact same order. No explanations, no numbering in the output.',
                    },
                    {
                        role: 'user',
                        content: `Translate these news article titles to English:\n${wordList}\n\nReturn ONLY: ["english title 1","english title 2",...]`,
                    },
                ]);

                const raw = response.choices[0]?.message?.content || '[]';
                const cleaned = raw.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
                const translations = JSON.parse(cleaned);

                for (let i = 0; i < needsTranslation.length; i++) {
                    const en = translations[i];
                    if (en && typeof en === 'string' && en.trim()) {
                        await supabase.from('articles')
                            .update({ title_en: en.trim() })
                            .eq('id', needsTranslation[i].id);
                        totalDone++;
                    }
                }
            } catch (groqErr) {
                log.ai.warn('[TRANSLATE-MIGRATION] Groq batch failed, skipping batch', {
                    error: groqErr.message?.substring(0, 80),
                });
            }
        }

        log.ai.info(`[TRANSLATE-MIGRATION] Progress: ${totalDone} titles translated so far...`);
        offset += BATCH_SIZE;

        // Small delay to avoid hammering Groq
        await new Promise(r => setTimeout(r, 1000));
    }

    log.ai.info(`[TRANSLATE-MIGRATION] Complete. Total titles translated: ${totalDone}`);
}

// ── Manual Scraper Trigger ─────────────────────────────────

// POST /api/admin/scrape/:clientId — manual trigger for specific client
// BUG FIX #11: Previously the clientId URL param was echoed back but completely
// ignored — runScraperCycle() ran for ALL clients. Now it is forwarded so the
// orchestrator can filter sources to only the requested client.
router.post('/scrape/:clientId', async (req, res) => {
    try {
        const { clientId } = req.params;
        res.json({ message: 'Scraper triggered', client_id: clientId });
        runScraperCycle(clientId).catch(e => log.scraper.error('Admin-triggered scrape failed', { clientId, error: e.message }));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
