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

        // D3: annotate each source with how many days since last successful scrape.
        // staleness_days=null means never scraped. staleness_days>=30 warrants attention.
        const now = Date.now();
        const annotated = (data || []).map(src => ({
            ...src,
            staleness_days: src.last_success_at
                ? Math.floor((now - new Date(src.last_success_at).getTime()) / 86400000)
                : null,
        }));

        res.json(annotated);
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

// POST /discover-rss — F3: auto-detect RSS feed URL from any website URL
// Tries <link rel="alternate"> in HTML head, then common feed paths.
// Returns discovered feeds so the operator can pick one and add it as a source.
router.post('/discover-rss', requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
    const { url } = req.body;
    if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'url is required' });
    }

    // Validate URL
    let parsed;
    try { parsed = new URL(url); } catch {
        return res.status(400).json({ error: 'Invalid URL' });
    }

    const UA = 'Mozilla/5.0 (compatible; ROBIN-OSINT/1.0)';
    const discovered = [];

    // Step 1: fetch page HTML and extract <link rel="alternate"> feed tags
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12000);
        const resp = await fetch(url, { headers: { 'User-Agent': UA }, signal: controller.signal });
        clearTimeout(timeout);

        if (resp.ok) {
            const html = await resp.text();
            const linkRe = /<link[^>]+rel=["']alternate["'][^>]*>/gi;
            let m;
            while ((m = linkRe.exec(html)) !== null) {
                const tag = m[0];
                const typeMatch = tag.match(/type=["']([^"']+)["']/i);
                const hrefMatch = tag.match(/href=["']([^"']+)["']/i);
                const titleMatch = tag.match(/title=["']([^"']+)["']/i);
                if (typeMatch && hrefMatch && /rss|atom|xml/i.test(typeMatch[1])) {
                    const feedUrl = new URL(hrefMatch[1], url).toString();
                    discovered.push({ url: feedUrl, title: titleMatch?.[1] || 'RSS Feed', source: 'link_tag' });
                }
            }
        }
    } catch { /* continue to path probing */ }

    // Step 2: probe common RSS paths if nothing found via link tag
    if (discovered.length === 0) {
        const origin = `${parsed.protocol}//${parsed.host}`;
        const COMMON_PATHS = ['/feed', '/rss', '/feed.xml', '/rss.xml', '/atom.xml', '/feeds/posts/default', '/blog/feed', '/news/feed'];
        for (const path of COMMON_PATHS) {
            try {
                const probeUrl = origin + path;
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 5000);
                const resp = await fetch(probeUrl, { method: 'HEAD', headers: { 'User-Agent': UA }, signal: controller.signal });
                clearTimeout(timeout);
                const ct = resp.headers.get('content-type') || '';
                if (resp.ok && /xml|rss|atom/i.test(ct)) {
                    discovered.push({ url: probeUrl, title: 'RSS Feed', source: 'path_probe' });
                    break; // one confirmed path is enough
                }
            } catch { /* try next path */ }
        }
    }

    res.json({ input_url: url, feeds: discovered, count: discovered.length });
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
