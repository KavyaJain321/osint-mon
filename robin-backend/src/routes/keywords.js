// ============================================================
// ROBIN OSINT — Keywords CRUD Routes
// ============================================================

import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roleCheck.js';
import { log } from '../lib/logger.js';
import { runKeywordExpansion } from '../ai/keyword-expander.js';
import { runKeywordClustering } from '../ai/keyword-clusterer.js';

const router = Router();
router.use(authenticate);

const KeywordSchema = z.object({
    keyword: z.string().min(1).max(200).transform((k) => k.trim().toLowerCase()),
});

// GET / — List keywords for this client (from active brief)
router.get('/', async (req, res) => {
    try {
        const { data: brief } = await supabase.from('client_briefs')
            .select('id').eq('client_id', req.user.clientId).eq('status', 'active').limit(1).single();
        if (!brief) return res.json([]);

        const { data, error } = await supabase
            .from('brief_generated_keywords')
            .select('*')
            .eq('brief_id', brief.id)
            .order('priority', { ascending: false })
            .limit(300);

        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        log.api.error('GET /keywords failed', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch keywords' });
    }
});

// POST / — Add a keyword (ADMIN only)
router.post('/', requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
    try {
        const parsed = KeywordSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: 'Invalid input', details: parsed.error.issues });

        const { data: brief } = await supabase.from('client_briefs')
            .select('id').eq('client_id', req.user.clientId).eq('status', 'active').limit(1).single();
        if (!brief) return res.status(400).json({ error: 'No active brief' });

        const { data, error } = await supabase.from('brief_generated_keywords').insert({
            keyword: parsed.data.keyword,
            brief_id: brief.id,
            category: 'general',
            priority: 5,
        }).select().single();

        if (error) {
            if (error.code === '23505') return res.status(409).json({ error: 'Keyword already exists' });
            throw error;
        }

        res.status(201).json(data);
    } catch (error) {
        log.api.error('POST /keywords failed', { error: error.message });
        res.status(500).json({ error: 'Failed to add keyword' });
    }
});

// GET /performance — Keyword match counts for active brief (7d + 30d)
router.get('/performance', async (req, res) => {
    try {
        const { data: brief } = await supabase.from('client_briefs')
            .select('id').eq('client_id', req.user.clientId).eq('status', 'active').limit(1).single();
        if (!brief) return res.json([]);

        const { data, error } = await supabase.rpc('get_keyword_performance', {
            brief_id_param: brief.id,
        });

        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        log.api.error('GET /keywords/performance failed', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch keyword performance' });
    }
});

// GET /analytics — Keyword hit counts (7d + 30d) with dead-keyword flag
// D2: Identifies which monitored keywords have never fired recently so operators
// can prune dead keywords and keep briefs focused.
router.get('/analytics', async (req, res) => {
    try {
        const clientId = req.user.clientId;

        // Load all active brief keywords
        const { data: brief } = await supabase.from('client_briefs')
            .select('id').eq('client_id', clientId).eq('status', 'active').limit(1).single();
        if (!brief) return res.json({ keywords: [], total: 0 });

        const { data: kwRows } = await supabase
            .from('brief_generated_keywords')
            .select('id, keyword, category, priority')
            .eq('brief_id', brief.id)
            .limit(300);

        if (!kwRows || kwRows.length === 0) return res.json({ keywords: [], total: 0 });

        // Fetch matched_keywords from recent content_items for this client
        const cutoff30d = new Date(Date.now() - 30 * 86400000).toISOString();
        const cutoff7d  = new Date(Date.now() -  7 * 86400000).toISOString();

        const { data: items30 } = await supabase
            .from('content_items')
            .select('matched_keywords, created_at')
            .eq('client_id', clientId)
            .gte('created_at', cutoff30d)
            .limit(2000);

        // Count hits per keyword over 30d and 7d windows
        const count30 = {};
        const count7  = {};
        const sevenDaysAgo = new Date(cutoff7d);
        for (const item of items30 || []) {
            const inLast7 = new Date(item.created_at) >= sevenDaysAgo;
            for (const kw of item.matched_keywords || []) {
                count30[kw] = (count30[kw] || 0) + 1;
                if (inLast7) count7[kw] = (count7[kw] || 0) + 1;
            }
        }

        const result = kwRows.map(row => ({
            id:           row.id,
            keyword:      row.keyword,
            category:     row.category,
            priority:     row.priority,
            hits_30d:     count30[row.keyword] || 0,
            hits_7d:      count7[row.keyword]  || 0,
            is_dead:      (count30[row.keyword] || 0) === 0,
        }));

        // Sort: dead keywords first, then by hits_30d desc
        result.sort((a, b) => {
            if (a.is_dead !== b.is_dead) return a.is_dead ? -1 : 1;
            return b.hits_30d - a.hits_30d;
        });

        res.json({
            keywords:   result,
            total:      result.length,
            dead_count: result.filter(r => r.is_dead).length,
            period_days: 30,
        });
    } catch (error) {
        log.api.error('GET /keywords/analytics failed', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch keyword analytics' });
    }
});

// GET /pending — Pending auto-discovered keywords awaiting review
router.get('/pending', async (req, res) => {
    try {
        const { data: brief } = await supabase.from('client_briefs')
            .select('id').eq('client_id', req.user.clientId).eq('status', 'active').limit(1).single();
        if (!brief) return res.json([]);

        const { data, error } = await supabase
            .from('brief_generated_keywords')
            .select('*')
            .eq('brief_id', brief.id)
            .eq('approved', false)
            .eq('rejected', false)
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        log.api.error('GET /keywords/pending failed', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch pending keywords' });
    }
});

// POST /:id/approve — Approve a pending keyword (ADMIN only)
router.post('/:id/approve', requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
    try {
        const { error } = await supabase
            .from('brief_generated_keywords')
            .update({ approved: true, rejected: false })
            .eq('id', req.params.id);
        if (error) throw error;
        res.json({ message: 'Keyword approved' });
    } catch (error) {
        log.api.error('POST /keywords/:id/approve failed', { error: error.message });
        res.status(500).json({ error: 'Failed to approve keyword' });
    }
});

// POST /:id/reject — Reject a pending keyword (ADMIN only)
router.post('/:id/reject', requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
    try {
        const { error } = await supabase
            .from('brief_generated_keywords')
            .update({ rejected: true, approved: false })
            .eq('id', req.params.id);
        if (error) throw error;
        res.json({ message: 'Keyword rejected' });
    } catch (error) {
        log.api.error('POST /keywords/:id/reject failed', { error: error.message });
        res.status(500).json({ error: 'Failed to reject keyword' });
    }
});

// POST /expand — Manually trigger keyword expansion for this client (ADMIN only)
router.post('/expand', requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
    try {
        const { data: brief } = await supabase.from('client_briefs')
            .select('id').eq('client_id', req.user.clientId).eq('status', 'active').limit(1).single();
        if (!brief) return res.status(400).json({ error: 'No active brief' });

        const { data: client } = await supabase.from('clients')
            .select('name').eq('id', req.user.clientId).single();

        // Run async — respond immediately so request doesn't time out
        res.json({ message: 'Keyword expansion started. Check pending keywords in a few seconds.' });

        runKeywordExpansion(req.user.clientId, brief.id, client?.name || 'Unknown')
            .catch(err => log.api.error('Manual keyword expansion failed', { error: err.message }));
    } catch (error) {
        log.api.error('POST /keywords/expand failed', { error: error.message });
        res.status(500).json({ error: 'Failed to start expansion' });
    }
});

// POST /cluster — Semantically cluster all keywords for this brief (ADMIN only)
router.post('/cluster', requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
    try {
        const { data: brief } = await supabase.from('client_briefs')
            .select('id').eq('client_id', req.user.clientId).eq('status', 'active').limit(1).single();
        if (!brief) return res.status(400).json({ error: 'No active brief' });

        const { data: client } = await supabase.from('clients')
            .select('name').eq('id', req.user.clientId).single();

        // Run async — respond immediately
        res.json({ message: 'Semantic clustering started. Refresh in a few seconds to see clusters.' });

        runKeywordClustering(brief.id, client?.name || 'Unknown')
            .catch(err => log.api.error('Manual clustering failed', { error: err.message }));
    } catch (error) {
        log.api.error('POST /keywords/cluster failed', { error: error.message });
        res.status(500).json({ error: 'Failed to start clustering' });
    }
});

// DELETE /:id — Delete keyword (ADMIN only)
router.delete('/:id', requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('brief_generated_keywords')
            .delete()
            .eq('id', req.params.id)
            .select('id')
            .single();

        if (error) throw error;
        res.json({ message: 'Keyword deleted', id: data.id });
    } catch (error) {
        log.api.error('DELETE /keywords failed', { error: error.message });
        res.status(500).json({ error: 'Failed to delete keyword' });
    }
});

export default router;
