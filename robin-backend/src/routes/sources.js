// ============================================================
// ROBIN OSINT — Sources CRUD Routes
// ============================================================

import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roleCheck.js';
import { log } from '../lib/logger.js';

const router = Router();
router.use(authenticate);

// BUG FIX #17: Added missing source types. The old schema only allowed 'rss', 'html',
// 'browser' — rejecting 'pdf', 'youtube', 'google_news', 'reddit', 'newspaper' with
// a 400 error even though the scraper supports all of them.
const SourceSchema = z.object({
    name: z.string().min(1).max(200),
    url: z.string().url(),
    source_type: z.enum(['rss', 'html', 'browser', 'pdf', 'youtube', 'google_news', 'reddit', 'newspaper']).default('rss'),
});

// GET / — List sources for this client
router.get('/', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('sources')
            .select('*')
            .eq('client_id', req.user.clientId)
            .order('created_at', { ascending: false })
            .limit(200);

        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        log.api.error('GET /sources failed', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch sources' });
    }
});

// POST / — Add a new source (ADMIN only)
router.post('/', requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
    try {
        const parsed = SourceSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: 'Invalid input', details: parsed.error.issues });

        // Check for duplicate URL
        const { data: existing } = await supabase.from('sources').select('id').eq('client_id', req.user.clientId).eq('url', parsed.data.url).limit(1).single();
        if (existing) return res.status(409).json({ error: 'Source URL already exists' });

        const { data, error } = await supabase.from('sources').insert({
            ...parsed.data,
            client_id: req.user.clientId,
        }).select().single();

        if (error) throw error;
        res.status(201).json(data);
    } catch (error) {
        log.api.error('POST /sources failed', { error: error.message });
        res.status(500).json({ error: 'Failed to add source' });
    }
});

// PATCH /:id — Update source
router.patch('/:id', requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
    try {
        const { name, url, is_active, source_type } = req.body;
        const updates = {};
        if (name !== undefined) updates.name = name;
        if (url !== undefined) updates.url = url;
        if (is_active !== undefined) updates.is_active = is_active;
        if (source_type !== undefined) updates.source_type = source_type;

        const { data, error } = await supabase.from('sources').update(updates).eq('id', req.params.id).eq('client_id', req.user.clientId).select().single();
        if (error) throw error;
        res.json(data);
    } catch (error) {
        log.api.error('PATCH /sources failed', { error: error.message });
        res.status(500).json({ error: 'Failed to update source' });
    }
});

// DELETE /:id — Soft delete (set is_active=false)
router.delete('/:id', requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
    try {
        const { data, error } = await supabase.from('sources').update({ is_active: false }).eq('id', req.params.id).eq('client_id', req.user.clientId).select('id').single();
        if (error) throw error;
        res.json({ message: 'Source deactivated', id: data.id });
    } catch (error) {
        log.api.error('DELETE /sources failed', { error: error.message });
        res.status(500).json({ error: 'Failed to deactivate source' });
    }
});

export default router;
