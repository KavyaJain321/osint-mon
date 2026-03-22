// ============================================================
// ROBIN OSINT — Analytics API Routes
// Sentiment, volume, keywords, sources, patterns, summary
// ============================================================

import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { authenticate } from '../middleware/auth.js';
import { log } from '../lib/logger.js';

const router = Router();
router.use(authenticate);

// GET /sentiment — Sentiment breakdown + trend + week comparison
router.get('/sentiment', async (req, res) => {
    try {
        const clientId = req.user.clientId;
        const days = parseInt(req.query.days) || 30;

        const { data: trend } = await supabase.rpc('get_sentiment_trend', {
            p_client_id: clientId,
            p_days: days,
        });

        // Calculate breakdown from trend data
        const totals = { positive: 0, negative: 0, neutral: 0, total: 0 };
        for (const row of (trend || [])) {
            totals.positive += parseInt(row.positive_count) || 0;
            totals.negative += parseInt(row.negative_count) || 0;
            totals.neutral += parseInt(row.neutral_count) || 0;
            totals.total += parseInt(row.total) || 0;
        }

        const pct = (n) => totals.total ? Math.round((n / totals.total) * 100) : 0;

        // This week vs last week comparison
        const thisWeek = (trend || []).slice(-7);
        const lastWeek = (trend || []).slice(-14, -7);
        const thisWeekPos = thisWeek.reduce((s, r) => s + (parseInt(r.positive_count) || 0), 0);
        const thisWeekTotal = thisWeek.reduce((s, r) => s + (parseInt(r.total) || 0), 0);
        const lastWeekPos = lastWeek.reduce((s, r) => s + (parseInt(r.positive_count) || 0), 0);
        const lastWeekTotal = lastWeek.reduce((s, r) => s + (parseInt(r.total) || 0), 0);
        const thisWeekPct = thisWeekTotal ? Math.round((thisWeekPos / thisWeekTotal) * 100) : 0;
        const lastWeekPct = lastWeekTotal ? Math.round((lastWeekPos / lastWeekTotal) * 100) : 0;

        res.json({
            breakdown: { ...totals, percentages: { positive: pct(totals.positive), negative: pct(totals.negative), neutral: pct(totals.neutral) } },
            trend: trend || [],
            comparison: { this_week_positive_pct: thisWeekPct, last_week_positive_pct: lastWeekPct, change: thisWeekPct - lastWeekPct },
        });
    } catch (error) {
        log.api.error('GET /analytics/sentiment failed', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch sentiment data' });
    }
});

// GET /volume — Daily article volume stats
router.get('/volume', async (req, res) => {
    try {
        const clientId = req.user.clientId;
        const days = parseInt(req.query.days) || 30;
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

        const { data: articles } = await supabase
            .from('articles')
            .select('published_at')
            .eq('client_id', clientId)
            .gte('published_at', since)
            .limit(5000);

        const daily = {};
        for (const a of (articles || [])) {
            const date = new Date(a.published_at).toISOString().split('T')[0];
            daily[date] = (daily[date] || 0) + 1;
        }

        const dailyArray = Object.entries(daily).map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date));
        const total = dailyArray.reduce((s, d) => s + d.count, 0);
        const today = new Date().toISOString().split('T')[0];

        res.json({
            daily: dailyArray,
            total,
            average_per_day: dailyArray.length ? Math.round(total / dailyArray.length) : 0,
            peak_day: dailyArray.length ? dailyArray.reduce((max, d) => d.count > max.count ? d : max) : null,
            today: daily[today] || 0,
        });
    } catch (error) {
        log.api.error('GET /analytics/volume failed', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch volume data' });
    }
});

// GET /keywords — Per-keyword article stats
// BUG FIX #12a: Replaced N+1 pattern (3 DB queries per keyword × up to 25 keywords = 75 queries)
// with a single bulk fetch of all articles in the time window, then aggregate in memory.
router.get('/keywords', async (req, res) => {
    try {
        const clientId = req.user.clientId;
        // Get keywords from active brief
        const { data: activeBrief } = await supabase.from('client_briefs').select('id').eq('client_id', clientId).eq('status', 'active').limit(1).single();
        const { data: keywords } = activeBrief
            ? await supabase.from('brief_generated_keywords').select('keyword').eq('brief_id', activeBrief.id).limit(100)
            : { data: [] };

        if (!keywords || keywords.length === 0) return res.json([]);

        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

        // Single query: fetch all matched_keywords arrays for this client in the 14-day window
        const [allTimeRes, windowRes] = await Promise.all([
            supabase.from('articles').select('matched_keywords').eq('client_id', clientId),
            supabase.from('articles').select('matched_keywords, published_at').eq('client_id', clientId).gte('published_at', fourteenDaysAgo),
        ]);

        // Build keyword → count maps in memory
        const totalMap = {};
        const thisWeekMap = {};
        const lastWeekMap = {};
        const kwSet = new Set((keywords || []).map(k => k.keyword));

        for (const row of (allTimeRes.data || [])) {
            for (const kw of (row.matched_keywords || [])) {
                if (kwSet.has(kw)) totalMap[kw] = (totalMap[kw] || 0) + 1;
            }
        }
        for (const row of (windowRes.data || [])) {
            const isThisWeek = row.published_at >= sevenDaysAgo;
            const isLastWeek = row.published_at >= fourteenDaysAgo && row.published_at < sevenDaysAgo;
            for (const kw of (row.matched_keywords || [])) {
                if (!kwSet.has(kw)) continue;
                if (isThisWeek) thisWeekMap[kw] = (thisWeekMap[kw] || 0) + 1;
                if (isLastWeek) lastWeekMap[kw] = (lastWeekMap[kw] || 0) + 1;
            }
        }

        const results = (keywords || []).map(({ keyword }) => {
            const tw = thisWeekMap[keyword] || 0;
            const lw = lastWeekMap[keyword] || 0;
            return {
                keyword,
                total_articles: totalMap[keyword] || 0,
                this_week: tw,
                last_week: lw,
                trend: tw > lw ? 'up' : tw < lw ? 'down' : 'stable',
            };
        });

        res.json(results);
    } catch (error) {
        log.api.error('GET /analytics/keywords failed', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch keyword analytics' });
    }
});

// GET /sources — Per-source stats
// BUG FIX #12b: Replaced N+1 pattern (1 DB query per source) with a single
// aggregation query, then join in memory. With 100 sources the old code made
// 101 round-trips; now it makes 2.
router.get('/sources', async (req, res) => {
    try {
        const clientId = req.user.clientId;
        const [sourcesRes, articlesRes] = await Promise.all([
            supabase.from('sources').select('id, name, last_scraped_at, scrape_success_count, scrape_fail_count').eq('client_id', clientId).limit(100),
            supabase.from('articles').select('source_id').eq('client_id', clientId),
        ]);

        // Count articles per source in memory
        const countMap = {};
        for (const { source_id } of (articlesRes.data || [])) {
            if (source_id) countMap[source_id] = (countMap[source_id] || 0) + 1;
        }

        const results = (sourcesRes.data || []).map(source => ({
            ...source,
            total_articles: countMap[source.id] || 0,
        }));

        res.json(results);
    } catch (error) {
        log.api.error('GET /analytics/sources failed', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch source analytics' });
    }
});

// GET /patterns — Latest narrative patterns
router.get('/patterns', async (req, res) => {
    try {
        const { data: pattern } = await supabase.from('narrative_patterns').select('*').eq('client_id', req.user.clientId).order('pattern_date', { ascending: false }).limit(1).single();
        res.json(pattern || { message: 'Intelligence patterns not yet generated.' });
    } catch (error) {
        res.json({ message: 'Intelligence patterns not yet generated.' });
    }
});

// GET /summary — Dashboard header stats
router.get('/summary', async (req, res) => {
    try {
        const clientId = req.user.clientId;
        const today = new Date().toISOString().split('T')[0];
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

        const { count: articlesToday } = await supabase.from('articles').select('id', { count: 'exact', head: true }).eq('client_id', clientId).gte('published_at', today);
        const { count: articlesWeek } = await supabase.from('articles').select('id', { count: 'exact', head: true }).eq('client_id', clientId).gte('published_at', weekAgo);

        // BUG FIX #30: Previously fetched only 200 articles then counted high-importance
        // among those — silently undercounting for clients with >200 unread articles.
        // Fixed by pushing the importance filter into the DB via an inner join.
        const { count: highImportanceCount } = await supabase
            .from('articles')
            .select('article_analysis!inner(importance_score)', { count: 'exact', head: true })
            .eq('client_id', clientId)
            .eq('is_tagged', false)
            .eq('analysis_status', 'complete')
            .gte('article_analysis.importance_score', 7);

        // Risk level
        const { data: pattern } = await supabase.from('narrative_patterns').select('risk_level').eq('client_id', clientId).order('pattern_date', { ascending: false }).limit(1).single();

        res.json({
            articles_today: articlesToday || 0,
            articles_this_week: articlesWeek || 0,
            high_importance_unread: highImportanceCount || 0,
            risk_level: pattern?.risk_level || 'low',
        });
    } catch (error) {
        log.api.error('GET /analytics/summary failed', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch summary' });
    }
});

export default router;
