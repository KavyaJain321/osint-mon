// ============================================================
// Brief Routes — Problem intake and AI-generated intelligence setup
// POST /api/briefs  — submit brief (async, returns 202)
// GET  /api/briefs  — list briefs for authenticated client
// GET  /api/briefs/:id — get brief with generated keywords + sources
// ============================================================

import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { log } from '../lib/logger.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roleCheck.js';
import { generateKeywordsFromBrief } from '../ai/keyword-generator.js';
import { discoverSourcesForBrief } from '../ai/source-discoverer.js';
import { runScraperCycle } from '../scrapers/orchestrator.js';
import { matchCuratedSources } from '../ai/curated-source-matcher.js';
import { updatePipelineStage, resetPipeline } from '../lib/pipeline-tracker.js';
import { triggerAndStore } from '../services/newspaper-intel-client.js';
import { getSourcesForBrief } from '../services/newspaper-sources.js';

// Fresh admin client — avoids session contamination from the shared singleton
const mkAdmin = () => createClient(config.supabaseUrl, config.supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
});

const router = Router();

// All brief routes require authentication
router.use(authenticate);

// ── POST /api/briefs — submit a new client brief ──────────
router.post('/', async (req, res) => {
    try {
        const { title, problem_statement, include_newspapers = false } = req.body;
        if (!title || !problem_statement) {
            return res.status(400).json({ error: 'title and problem_statement are required' });
        }
        if (problem_statement.length < 50) {
            return res.status(400).json({ error: 'problem_statement must be at least 50 characters' });
        }

        let clientId = req.user?.client_id;

        // SUPER_ADMIN may have no client_id — look up from users table
        if (!clientId) {
            const { data: profile } = await supabase
                .from('users')
                .select('client_id')
                .eq('id', req.user.id)
                .single();
            clientId = profile?.client_id;
        }

        if (!clientId) return res.status(403).json({ error: 'No client associated with this account. Ask an administrator to assign you to a client.' });

        // Get client info for LLM context — use fresh admin client to avoid session contamination
        const admin = mkAdmin();
        const { data: client, error: clientLookupErr } = await admin
            .from('clients')
            .select('id, name, industry')
            .eq('id', clientId)
            .maybeSingle();

        console.log('[BRIEF] clientId =', clientId, '=> client =', client?.name, 'err =', clientLookupErr?.message);

        if (clientLookupErr) {
            return res.status(500).json({ error: `Client lookup failed: ${clientLookupErr.message}` });
        }
        if (!client) return res.status(404).json({ error: `Client not found (id: ${clientId})` });

        // ── Clean up previous briefs and their stale data ──────────
        // Deactivate old briefs
        const { data: oldBriefs } = await admin
            .from('client_briefs')
            .select('id')
            .eq('client_id', clientId)
            .in('status', ['active', 'pending_review', 'processing']);

        if (oldBriefs && oldBriefs.length > 0) {
            const oldBriefIds = oldBriefs.map(b => b.id);
            log.system.info('Replacing old briefs', { clientId, count: oldBriefIds.length });

            // Mark old briefs as replaced
            await admin.from('client_briefs')
                .update({ status: 'replaced' })
                .eq('client_id', clientId)
                .in('status', ['active', 'pending_review', 'processing']);

            // Clean up old brief-specific data
            for (const oldId of oldBriefIds) {
                await admin.from('brief_generated_keywords').delete().eq('brief_id', oldId);
                await admin.from('brief_recommended_sources').delete().eq('brief_id', oldId);
            }
        }

        // Clean up stale intelligence data for this client
        // (so new brief starts fresh — articles, signals, entities, threats)
        // Step 1: Get article IDs and delete analysis first (FK dependency)
        const { data: oldArticles } = await admin.from('articles').select('id').eq('client_id', clientId);
        const oldArticleIds = (oldArticles || []).map(a => a.id);
        if (oldArticleIds.length > 0) {
            // Delete in batches of 100 to avoid query length limits
            for (let i = 0; i < oldArticleIds.length; i += 100) {
                const batch = oldArticleIds.slice(i, i + 100);
                await admin.from('article_analysis').delete().in('article_id', batch);
            }
        }

        // ── Preserve pre-seeded sources before cleanup ──────────
        // Save all existing sources for this client so we can re-insert them
        // after the cleanup (they are the mandatory/seeded sources from Excel)
        // ── IMPORTANT: include `id` so we can restore sources with their ORIGINAL UUIDs ──
        // If we let Postgres auto-generate new UUIDs on re-insert, any content_items
        // rows written during the same scrape cycle (YouTube videos, Reddit posts)
        // that reference the OLD source_id will violate the FK constraint.
        const { data: preSeededSources } = await admin
            .from('sources')
            .select('id, name, url, source_type, client_id, is_active')
            .eq('client_id', clientId);
        const savedSources = (preSeededSources || []).map(s => ({
            id: s.id,           // ← preserve UUID so FK refs in content_items stay valid
            name: s.name,
            url: s.url,
            source_type: s.source_type,
            client_id: s.client_id,
            is_active: s.is_active,
        }));
        log.system.info('Preserved pre-seeded sources for re-insertion', { clientId, count: savedSources.length });

        // Step 2: Delete remaining data in parallel (no FK conflicts)
        await Promise.all([
            admin.from('articles').delete().eq('client_id', clientId),
            admin.from('intelligence_signals').delete().eq('client_id', clientId),
            admin.from('entity_profiles').delete().eq('client_id', clientId),
            admin.from('threat_assessments').delete().eq('client_id', clientId),
            admin.from('inference_chains').delete().eq('client_id', clientId),
            admin.from('content_items').delete().eq('client_id', clientId),
            admin.from('sources').delete().eq('client_id', clientId),
            admin.from('watch_expressions').delete().eq('client_id', clientId),
        ]);

        // ── Re-insert pre-seeded sources ──────────────────────────
        if (savedSources.length > 0) {
            const BATCH = 50;
            for (let i = 0; i < savedSources.length; i += BATCH) {
                const batch = savedSources.slice(i, i + BATCH);
                // Use upsert with onConflict:'id' so existing rows are updated in-place
                // rather than getting new auto-generated UUIDs that would break FK refs.
                await admin.from('sources').upsert(batch, { onConflict: 'id' });
            }
            log.system.info('Re-inserted pre-seeded sources (UUIDs preserved)', { clientId, count: savedSources.length });
        }

        log.system.info('Stale data cleaned for new brief', { clientId });

        // Save brief immediately with status: processing
        const { data: brief, error: briefError } = await admin
            .from('client_briefs')
            .insert({
                client_id: clientId,
                title,
                problem_statement,
                status: 'processing',
                created_by: req.user.id,
                include_newspapers: Boolean(include_newspapers),
            })
            .select()
            .single();

        if (briefError) throw briefError;

        // Return 202 immediately — don't block on AI processing
        res.status(202).json({
            message: 'Brief received. AI is generating keywords and source recommendations.',
            brief_id: brief.id,
            status: 'processing',
            poll_url: `/api/briefs/${brief.id}`,
        });

        // Run AI pipeline in background
        processBriefAsync(brief.id, problem_statement, client, Boolean(include_newspapers)).catch(async (err) => {
            log.ai.error('Brief processing failed', { briefId: brief.id, error: err.message });
            await mkAdmin().from('client_briefs').update({ status: 'failed' }).eq('id', brief.id);
        });

    } catch (err) {
        log.system.error('Brief creation error', { error: err.message });
        res.status(500).json({ error: err.message });
    }
});

// ── Background AI processing ───────────────────────────────
async function processBriefAsync(briefId, problemStatement, client, includeNewspapers = false) {
    log.ai.info('Brief AI processing started', { briefId });
    const db = mkAdmin(); // fresh admin client per background task

    // ── Pipeline tracking ──
    await resetPipeline();
    await updatePipelineStage('keywords', 'Analyzing problem statement and generating keywords...', { briefId });

    // Run keyword generation and get context
    const { context, keywords } = await generateKeywordsFromBrief(problemStatement, client.name);

    // Discover sources using AI + curated database
    await updatePipelineStage('sources', `Generated ${keywords.length} keywords. Discovering sources...`, { keywords: keywords.length });
    const aiSources = await discoverSourcesForBrief(context);

    // Match curated sources from the media_outlets database
    let curatedSources = [];
    try {
        curatedSources = await matchCuratedSources(context, problemStatement);
        log.ai.info('Curated sources matched', { briefId, count: curatedSources.length });
    } catch (err) {
        log.ai.error('Curated source matching failed (non-fatal)', { error: err.message });
    }

    // Merge: curated first (higher quality), then AI sources, dedup by domain
    const seenDomains = new Set();
    const sources = [];
    for (const s of [...curatedSources, ...aiSources]) {
        const domain = (s.url || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
        if (domain && !seenDomains.has(domain)) {
            seenDomains.add(domain);
            sources.push(s);
        }
    }
    log.ai.info('Sources merged', { ai: aiSources.length, curated: curatedSources.length, merged: sources.length });

    // Update brief with extracted context
    await db.from('client_briefs').update({
        industry: context.industry,
        risk_domains: context.risk_domains || [],
        entities_of_interest: context.entities_of_interest || [],
        competitors: context.competitors || [],
        geographic_focus: context.geographic_focus || [],
        status: 'pending_review',
    }).eq('id', briefId);

    // Save keywords
    if (keywords.length > 0) {
        await db.from('brief_generated_keywords').insert(
            keywords.map(kw => ({
                brief_id: briefId,
                keyword: kw.keyword,
                category: kw.category,
                priority: kw.priority || 5,
                rationale: kw.rationale || '',
            }))
        );
    }

    // Save recommended sources
    if (sources.length > 0) {
        // Map source_type to values the DB actually accepts
        // (migration-005 may not be applied yet — only rss/html/browser/pdf/youtube are safe)
        const TYPE_MAP = {
            rss: 'rss', html: 'html', browser: 'browser', pdf: 'pdf', youtube: 'youtube',
            reddit: 'html', google_news: 'rss', twitter: 'html',
            govt_portal: 'html', podcast: 'html',
        };

        const cleanSources = sources.map(s => ({
            brief_id: briefId,
            name: s.name,
            url: s.url,
            source_type: TYPE_MAP[s.source_type] || 'html',
            expected_hit_rate: s.expected_hit_rate || 'medium',
            rationale: s.rationale || '',
        }));

        const { error: srcInsertErr } = await db.from('brief_recommended_sources').insert(cleanSources);
        if (srcInsertErr) {
            log.ai.error('Failed to save recommended sources', { briefId, error: srcInsertErr.message, code: srcInsertErr.code });
        } else {
            log.ai.info('Sources saved', { briefId, count: cleanSources.length });
        }
    }

    log.ai.info('Brief AI processing complete', {
        briefId,
        keywords: keywords.length,
        sources: sources.length,
    });

    // ── Auto-push sources to scraper + trigger immediate scrape ──
    // This eliminates the 2-hour wait for data to appear on the dashboard.
    try {
        const pushDb = mkAdmin();

        // Get the brief's client_id
        const { data: briefData } = await pushDb.from('client_briefs').select('client_id').eq('id', briefId).single();
        if (!briefData) throw new Error('Brief not found for auto-push');
        const clientId = briefData.client_id;

        // Push recommended sources → sources table
        const { data: recSources } = await pushDb.from('brief_recommended_sources').select('name, url, source_type').eq('brief_id', briefId);

        if (recSources && recSources.length > 0) {
            const { data: existing } = await pushDb.from('sources').select('url').eq('client_id', clientId);
            const existingUrls = new Set((existing || []).map(s => s.url.toLowerCase().replace(/\/+$/, '')));

            const newSources = recSources
                .filter(s => !existingUrls.has(s.url.toLowerCase().replace(/\/+$/, '')))
                .map(s => ({
                    name: s.name,
                    url: s.url,
                    source_type: s.source_type,
                    client_id: clientId,
                    is_active: true,
                }));

            if (newSources.length > 0) {
                const { error: srcErr } = await pushDb.from('sources').insert(newSources);
                if (srcErr) {
                    log.system.error('Auto-push sources failed', { briefId, error: srcErr.message });
                } else {
                    log.system.info('Sources auto-pushed', { briefId, count: newSources.length });
                }
            }
        }

        // Activate the brief
        await pushDb.from('client_briefs').update({ status: 'active', activated_at: new Date().toISOString() }).eq('id', briefId);
        log.system.info('Brief auto-activated', { briefId });

        // Trigger immediate scraper run (fire-and-forget)
        log.system.info('Auto-triggering scraper after brief processing', { briefId });
        await updatePipelineStage('scraping', 'Sources saved. Starting scraper...', { sources: sources.length });
        runScraperCycle().catch(err =>
            log.system.error('Auto-scrape after brief failed', { briefId, error: err.message })
        );

        // ── Queue newspaper extraction jobs (if enabled) ──────────
        // Only runs when include_newspapers=true AND the service is configured.
        // Fire-and-forget: each job is tracked in brief_newspaper_jobs.
        if (includeNewspapers && config.hasNewspaperIntel) {
            const geographicStates = context.geographic_focus || [];
            const keywordStrings   = keywords.map(k => k.keyword).filter(Boolean);
            const relevantSources  = getSourcesForBrief(geographicStates);

            log.system.info('Queueing newspaper extraction jobs', {
                briefId,
                geographicStates,
                sources: relevantSources.length,
                keywords: keywordStrings.length,
            });

            // Sequential fire-and-forget — no await, errors are per-source
            ;(async () => {
                for (const source of relevantSources) {
                    try {
                        await triggerAndStore(
                            source.base_url || '',           // pdf_url / base URL
                            keywordStrings,
                            source.name,
                            briefId,
                            clientId,
                            pushDb,                          // ROBIN's Supabase client
                            {
                                source_language: source.language,
                                is_flipbook: source.scraper_type === 'flipbook_intercept',
                            },
                        );
                    } catch (srcErr) {
                        // Non-fatal — log and continue with other sources
                        log.system.error('Failed to queue newspaper job', {
                            briefId,
                            source: source.name,
                            error: srcErr.message,
                        });
                    }
                }
                log.system.info('All newspaper jobs submitted', { briefId, total: relevantSources.length });
            })();
        }

    } catch (pushErr) {
        log.system.error('Auto-push/scrape failed', { briefId, error: pushErr.message });
    }
}

// ── GET /api/briefs — list briefs for this client ─────────
router.get('/', async (req, res) => {
    try {
        const clientId = req.user?.client_id;
        if (!clientId) return res.status(403).json({ error: 'No client associated' });

        const { data, error } = await mkAdmin()
            .from('client_briefs')
            .select('id, title, problem_statement, industry, status, risk_domains, entities_of_interest, geographic_focus, intake_mode, entity_names, created_at, activated_at')
            .eq('client_id', clientId)
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json({ data: data || [] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── GET /api/briefs/:id — get full brief with keywords and sources ──
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const clientId = req.user?.client_id;
        const db = mkAdmin();

        const { data: brief, error } = await db
            .from('client_briefs')
            .select('*')
            .eq('id', id)
            .single();

        if (error || !brief) return res.status(404).json({ error: 'Brief not found' });

        // Ensure user can only see their own client's briefs (unless admin)
        if (brief.client_id !== clientId && req.user?.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Access denied' });
        }

        const [kwRes, srcRes] = await Promise.all([
            db.from('brief_generated_keywords').select('*').eq('brief_id', id).order('priority', { ascending: false }),
            db.from('brief_recommended_sources').select('*').eq('brief_id', id),
        ]);

        res.json({
            brief,
            keywords: kwRes.data || [],
            recommended_sources: srcRes.data || [],
            summary: {
                total_keywords: (kwRes.data || []).length,
                approved_keywords: (kwRes.data || []).filter(k => k.approved).length,
                total_sources: (srcRes.data || []).length,
                approved_sources: (srcRes.data || []).filter(s => s.approved).length,
            },
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── POST /api/briefs/:id/push — activate/push brief sources ──
// Marks the brief as active, copies recommended sources into the sources table,
// and copies keywords into watch_expressions so the scraper picks them up.
router.post('/:id/push', async (req, res) => {
    try {
        const { id } = req.params;
        const clientId = req.user?.client_id;
        const db = mkAdmin();

        const { data: brief, error: fetchErr } = await db
            .from('client_briefs')
            .select('id, client_id, status')
            .eq('id', id)
            .single();

        if (fetchErr || !brief) return res.status(404).json({ error: 'Brief not found' });
        if (brief.client_id !== clientId && req.user?.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Only push once (idempotent)
        if (brief.status !== 'active') {
            // 1. Flip brief status
            const { error: updateErr } = await db
                .from('client_briefs')
                .update({ status: 'active', activated_at: new Date().toISOString() })
                .eq('id', id);
            if (updateErr) throw updateErr;

            // 2. Copy recommended sources → sources table
            const { data: recSources } = await db
                .from('brief_recommended_sources')
                .select('name, url, source_type')
                .eq('brief_id', id);

            if (recSources && recSources.length > 0) {
                // Get existing source URLs for this client to avoid duplicates
                const { data: existing } = await db
                    .from('sources')
                    .select('url')
                    .eq('client_id', brief.client_id);
                const existingUrls = new Set((existing || []).map(s => s.url.toLowerCase().replace(/\/+$/, '')));

                const newSources = recSources
                    .filter(s => !existingUrls.has(s.url.toLowerCase().replace(/\/+$/, '')))
                    .map(s => ({
                        name: s.name,
                        url: s.url,
                        source_type: s.source_type,
                        client_id: brief.client_id,
                        is_active: true,
                    }));

                if (newSources.length > 0) {
                    const { error: srcErr } = await db.from('sources').insert(newSources);
                    if (srcErr) {
                        log.system.error('Failed to push sources', { briefId: id, error: srcErr.message });
                    } else {
                        log.system.info('Sources pushed to scraper', { briefId: id, count: newSources.length });
                    }
                }
            }

            // 3. Copy keywords → watch_expressions table
            const { data: keywords } = await db
                .from('brief_generated_keywords')
                .select('keyword, category')
                .eq('brief_id', id);

            if (keywords && keywords.length > 0) {
                // Get existing watch expressions for this client
                const { data: existingKw } = await db
                    .from('watch_expressions')
                    .select('expression')
                    .eq('client_id', brief.client_id);
                const existingSet = new Set((existingKw || []).map(k => k.expression.toLowerCase()));

                const newKeywords = keywords
                    .filter(k => !existingSet.has(k.keyword.toLowerCase()))
                    .map(k => ({
                        expression: k.keyword,
                        match_type: 'keyword',
                        client_id: brief.client_id,
                        is_active: true,
                    }));

                if (newKeywords.length > 0) {
                    const { error: kwErr } = await db.from('watch_expressions').insert(newKeywords);
                    if (kwErr) {
                        log.system.error('Failed to push keywords', { briefId: id, error: kwErr.message });
                    } else {
                        log.system.info('Keywords pushed', { briefId: id, count: newKeywords.length });
                    }
                }
            }
        }

        res.json({ message: 'Brief activated', id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// ── DELETE /api/briefs/:id ─────────────────────────────────
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const clientId = req.user?.client_id;
        const { error } = await mkAdmin()
            .from('client_briefs')
            .delete()
            .eq('id', id)
            .eq('client_id', clientId); // scoped to client

        if (error) throw error;
        res.json({ message: 'Brief deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
