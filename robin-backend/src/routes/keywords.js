// ============================================================
// ROBIN OSINT — Keywords CRUD Routes
// ============================================================

import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roleCheck.js';
import { log } from '../lib/logger.js';

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
            .limit(200);

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
