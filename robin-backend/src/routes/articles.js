// ============================================================
// ROBIN OSINT — Articles API Routes
// Paginated feed, article detail, tagging, manual scrape trigger
// ============================================================

import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roleCheck.js';
import { scrapeSourceById } from '../scrapers/orchestrator.js';
import { log } from '../lib/logger.js';

const router = Router();
router.use(authenticate);

// GET / — Paginated article feed with filters
// BUG FIX #8: sentiment and min_score filters were previously applied in JavaScript
// AFTER fetching a page from the DB. This made the pagination `total` and
// `total_pages` values reflect the UNFILTERED DB count, not the filtered count.
// Fix: when sentiment/min_score are requested, join article_analysis in the DB
// query so the count and pagination are always accurate.
router.get('/', async (req, res) => {
    try {
        let clientId;
        if (req.user.role === 'SUPER_ADMIN') {
            // Explicit override via query param, or fall back to admin's own client_id
            clientId = req.query.clientId || null;
            if (!clientId) {
                const { data: profile } = await supabase
                    .from('users')
                    .select('client_id')
                    .eq('id', req.user.id)
                    .single();
                clientId = profile?.client_id || null;
            }
        } else {
            clientId = req.user.clientId;
        }
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
        const offset = (page - 1) * limit;


        // Support ?date=YYYY-MM-DD shorthand (used by Daily Intel)
        let fromDate = req.query.from_date || null;
        let toDate = req.query.to_date || null;
        if (req.query.date && !fromDate && !toDate) {
            fromDate = `${req.query.date}T00:00:00.000Z`;
            toDate = `${req.query.date}T23:59:59.999Z`;
        }

        const hasSentimentFilter = !!req.query.sentiment;
        const hasScoreFilter = !!req.query.min_score;

        let articles, count;

        if (hasSentimentFilter || hasScoreFilter) {
            // Join with article_analysis so filters hit the DB and count is correct
            let query = supabase
                .from('articles')
                .select(
                    'id, title, title_en, url, published_at, matched_keywords, is_tagged, analysis_status, source_id, client_id, created_at, article_analysis!inner(article_id, summary, sentiment, importance_score, importance_reason, narrative_frame, entities)',
                    { count: 'exact' }
                );

            if (clientId) query = query.eq('client_id', clientId);
            if (req.query.source_id) query = query.eq('source_id', req.query.source_id);
            if (fromDate) query = query.gte('published_at', fromDate);
            if (toDate) query = query.lte('published_at', toDate);
            if (req.query.tagged_only === 'true') query = query.eq('is_tagged', true);
            if (req.query.keyword) query = query.contains('matched_keywords', [req.query.keyword]);
            if (hasSentimentFilter) query = query.eq('article_analysis.sentiment', req.query.sentiment);
            if (hasScoreFilter) query = query.gte('article_analysis.importance_score', parseInt(req.query.min_score));

            query = query.order('published_at', { ascending: false }).range(offset, offset + limit - 1);

            const { data, error, count: c } = await query;
            if (error) throw error;

            // Flatten the joined analysis back into the article object
            articles = (data || []).map(a => {
                const { article_analysis, ...rest } = a;
                return { ...rest, analysis: Array.isArray(article_analysis) ? article_analysis[0] : article_analysis };
            });
            count = c;
        } else {
            // No analysis filters — standard query, then attach analysis separately
            let query = supabase
                .from('articles')
                .select('id, title, title_en, url, published_at, matched_keywords, is_tagged, analysis_status, source_id, client_id, created_at', { count: 'exact' });

            if (clientId) query = query.eq('client_id', clientId);
            if (req.query.source_id) query = query.eq('source_id', req.query.source_id);
            if (fromDate) query = query.gte('published_at', fromDate);
            if (toDate) query = query.lte('published_at', toDate);
            if (req.query.tagged_only === 'true') query = query.eq('is_tagged', true);
            if (req.query.keyword) query = query.contains('matched_keywords', [req.query.keyword]);

            query = query.order('published_at', { ascending: false }).range(offset, offset + limit - 1);

            const { data, error, count: c } = await query;
            if (error) throw error;

            const articleIds = (data || []).map(a => a.id);
            const { data: analyses } = articleIds.length > 0
                ? await supabase
                    .from('article_analysis')
                    .select('article_id, summary, sentiment, importance_score, importance_reason, narrative_frame, entities')
                    .in('article_id', articleIds)
                : { data: [] };

            const analysisMap = {};
            for (const a of (analyses || [])) analysisMap[a.article_id] = a;

            articles = (data || []).map(article => ({ ...article, analysis: analysisMap[article.id] || null }));
            count = c;
        }

        res.json({
            data: articles,
            pagination: { total: count, page, limit, total_pages: Math.ceil((count || 0) / limit) },
        });
    } catch (error) {
        log.api.error('GET /articles failed', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch articles' });
    }
});

// GET /:id — Single article detail
router.get('/:id', async (req, res) => {
    try {
        const { data: article, error } = await supabase
            .from('articles')
            .select('*')
            .eq('id', req.params.id)
            .single();

        if (error || !article) return res.status(404).json({ error: 'Article not found' });
        if (req.user.role !== 'SUPER_ADMIN' && article.client_id !== req.user.clientId) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const { data: analysis } = await supabase
            .from('article_analysis')
            .select('*')
            .eq('article_id', article.id)
            .single();

        res.json({ ...article, analysis: analysis || null });
    } catch (error) {
        log.api.error('GET /articles/:id failed', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch article' });
    }
});

// PATCH /:id/tag — Toggle tagged status
// BUG FIX #13: SUPER_ADMIN has no clientId (or a different one), so filtering
// .eq('client_id', req.user.clientId) silently matched 0 rows for them.
// Now SUPER_ADMIN can tag any article; regular users are scoped to their client.
router.patch('/:id/tag', async (req, res) => {
    try {
        const { is_tagged } = req.body;
        if (typeof is_tagged !== 'boolean') {
            return res.status(400).json({ error: 'is_tagged must be a boolean' });
        }

        let query = supabase
            .from('articles')
            .update({ is_tagged })
            .eq('id', req.params.id);

        // Scope to user's client unless SUPER_ADMIN
        if (req.user.role !== 'SUPER_ADMIN') {
            query = query.eq('client_id', req.user.clientId);
        }

        const { data, error } = await query.select('id, is_tagged').single();
        if (error) throw error;
        if (!data) return res.status(404).json({ error: 'Article not found or access denied' });
        res.json(data);
    } catch (error) {
        log.api.error('PATCH /articles/:id/tag failed', { error: error.message });
        res.status(500).json({ error: 'Failed to update tag' });
    }
});

// POST /trigger-scrape/:sourceId — Manual scrape trigger
router.post('/trigger-scrape/:sourceId', requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
    try {
        const { sourceId } = req.params;

        // Verify source belongs to user's client
        if (req.user.role !== 'SUPER_ADMIN') {
            const { data: source } = await supabase
                .from('sources')
                .select('client_id')
                .eq('id', sourceId)
                .single();

            if (!source || source.client_id !== req.user.clientId) {
                return res.status(403).json({ error: 'Source not found or access denied' });
            }
        }

        // Trigger async scrape
        scrapeSourceById(sourceId).catch((err) => {
            log.scraper.error('Manual scrape failed', { sourceId, error: err.message });
        });

        res.json({ message: 'Scrape triggered', sourceId });
    } catch (error) {
        log.api.error('POST /trigger-scrape failed', { error: error.message });
        res.status(500).json({ error: 'Failed to trigger scrape' });
    }
});

export default router;
