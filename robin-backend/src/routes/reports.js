// ============================================================
// ROBIN OSINT — Reports Route
// Intelligence report generation via Groq
// ============================================================

import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roleCheck.js';
import { groqChat } from '../lib/groq.js';
import { log } from '../lib/logger.js';

const router = Router();
router.use(authenticate);

const ReportSchema = z.object({
    title: z.string().min(1).max(200),
    date_from: z.string(),
    date_to: z.string(),
});

// GET / — List reports for this client
router.get('/', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('reports')
            .select('id, title, date_from, date_to, created_at')
            .eq('client_id', req.user.clientId)
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        log.api.error('GET /reports failed', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch reports' });
    }
});

// POST /generate — Generate an intelligence report (ADMIN only)
router.post('/generate', requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
    try {
        const parsed = ReportSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: 'Invalid input', details: parsed.error.issues });

        const { title, date_from, date_to } = parsed.data;

        // Fetch client info
        const { data: client } = await supabase.from('clients').select('name, industry').eq('id', req.user.clientId).single();
        const clientName = client?.name || 'Unknown';

        // Fetch articles in date range with analysis from both tables
        const [legacyRes, newItemsRes] = await Promise.all([
            supabase.from('articles')
                .select('id, title, url, published_at, matched_keywords')
                .eq('client_id', req.user.clientId)
                .eq('analysis_status', 'complete')
                .gte('published_at', date_from)
                .lte('published_at', date_to)
                .order('published_at', { ascending: false })
                .limit(100),
            supabase.from('content_items')
                .select('id, title, url, published_at, matched_keywords')
                .eq('client_id', req.user.clientId)
                .eq('analysis_status', 'complete')
                .gte('published_at', date_from)
                .lte('published_at', date_to)
                .order('published_at', { ascending: false })
                .limit(100)
        ]);
        
        const mergedMap = new Map();
        (legacyRes.data || []).forEach(a => mergedMap.set(a.id, a));
        (newItemsRes.data || []).forEach(c => mergedMap.set(c.id, c));
        
        const articles = Array.from(mergedMap.values())
            .sort((a, b) => new Date(b.published_at) - new Date(a.published_at))
            .slice(0, 100);

        // Fetch analyses for these articles
        const articleIds = (articles || []).map((a) => a.id);
        const { data: analyses } = articleIds.length > 0
            ? await supabase.from('article_analysis').select('*').in('article_id', articleIds)
            : { data: [] };

        // Fetch narrative patterns
        const { data: patterns } = await supabase
            .from('narrative_patterns')
            .select('*')
            .eq('client_id', req.user.clientId)
            .gte('pattern_date', date_from)
            .lte('pattern_date', date_to)
            .order('pattern_date', { ascending: false })
            .limit(7);

        // Generate report via Groq
        const topArticles = (analyses || [])
            .sort((a, b) => (b.importance_score || 0) - (a.importance_score || 0))
            .slice(0, 10)
            .map((a) => `- ${a.summary} (Sentiment: ${a.sentiment}, Score: ${a.importance_score})`);

        const response = await groqChat([
            { role: 'system', content: 'You are an intelligence report writer. Generate professional, structured reports.' },
            {
                role: 'user',
                content: `Generate an intelligence brief for ${clientName} covering ${date_from} to ${date_to}. Include:
Executive summary, key themes, top 5 articles with summaries, sentiment analysis, risk assessment, recommended actions.

Data:
- Total articles: ${(articles || []).length}
- Top articles by importance:
${topArticles.join('\n')}
- Latest patterns: ${JSON.stringify((patterns || []).slice(0, 3))}

Format as a structured report with clear sections.`,
            },
        ], { max_tokens: 3000 });

        const reportContent = response.choices[0]?.message?.content || 'Report generation failed.';

        // Save to database
        const { data: report, error: saveError } = await supabase.from('reports').insert({
            client_id: req.user.clientId,
            title,
            content: reportContent,
            date_from,
            date_to,
            generated_by: req.user.id,
        }).select().single();

        if (saveError) throw saveError;

        res.status(201).json({ id: report.id, title, content: reportContent });
    } catch (error) {
        log.api.error('POST /reports/generate failed', { error: error.message });
        res.status(500).json({ error: 'Failed to generate report' });
    }
});

// GET /:id — Full report
router.get('/:id', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('reports')
            .select('*')
            .eq('id', req.params.id)
            .eq('client_id', req.user.clientId)
            .single();

        if (error || !data) return res.status(404).json({ error: 'Report not found' });
        res.json(data);
    } catch (error) {
        log.api.error('GET /reports/:id failed', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch report' });
    }
});

export default router;
