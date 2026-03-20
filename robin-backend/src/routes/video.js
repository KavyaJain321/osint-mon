// ============================================================
// ROBIN OSINT — Video Processing API Routes
// Endpoints for transcript, clips, search, and manual processing
// ============================================================

import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { log } from '../lib/logger.js';
import { searchKeyword, formatTimestamp } from '../services/video-processor/search-service.js';

const router = Router();

/** Retry a Supabase query up to 3 times on network failure (TypeError: fetch failed). */
async function withRetry(fn, label) {
    let lastErr;
    for (let i = 0; i < 3; i++) {
        try { return await fn(); } catch (err) {
            lastErr = err;
            if (err.message?.includes('fetch failed') || err.code === 'ECONNRESET') {
                await new Promise(r => setTimeout(r, 500 * (i + 1)));
            } else {
                throw err; // Non-network error — don't retry
            }
        }
    }
    throw new Error(`${label} failed after 3 retries: ${lastErr?.message}`);
}

// ── GET /api/test/video/:id/transcript ───────────────────────
// Get full transcript + keyword occurrences for a video
router.get('/:id/transcript', async (req, res) => {
    try {
        const { id } = req.params;

        const { data, error } = await withRetry(
            () => supabase.from('video_transcripts').select('*').eq('article_id', id).single(),
            'transcript fetch'
        );

        if (error || !data) {
            return res.json({ data: null, message: 'No transcript available' });
        }

        res.json({
            data: {
                fullText: data.full_text,
                segments: data.segments,
                words: data.words,
                durationSeconds: data.duration_seconds,
                language: data.language,
                keywordOccurrences: data.keyword_occurrences,
                aiSummary: data.ai_summary,
                createdAt: data.created_at,
            },
        });
    } catch (error) {
        log.system.error('Transcript fetch failed', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch transcript' });
    }
});

// ── GET /api/test/video/:id/clips ────────────────────────────
// Get all generated clips for a video
router.get('/:id/clips', async (req, res) => {
    try {
        const { id } = req.params;

        const { data, error } = await withRetry(
            () => supabase.from('video_clips').select('*').eq('article_id', id).order('start_time', { ascending: true }),
            'clips fetch'
        );

        if (error) throw error;

        const clips = (data || []).map(clip => ({
            id: clip.id,
            keyword: clip.keyword,
            startTime: clip.start_time,
            endTime: clip.end_time,
            duration: clip.end_time - clip.start_time,
            clipUrl: clip.clip_url,
            transcriptSegment: clip.transcript_segment,
            aiSummary: clip.ai_summary,
            startFormatted: formatTimestamp(clip.start_time),
            endFormatted: formatTimestamp(clip.end_time),
        }));

        res.json({ data: clips, count: clips.length });
    } catch (error) {
        log.system.error('Clips fetch failed', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch clips' });
    }
});

// ── GET /api/test/video/:id/search?q=keyword ─────────────────
// Search within a video's transcript
router.get('/:id/search', async (req, res) => {
    try {
        const { id } = req.params;
        const query = req.query.q || '';

        if (!query.trim()) {
            return res.status(400).json({ error: 'Missing search query ?q=' });
        }

        // Fetch transcript
        const { data: transcript, error } = await supabase
            .from('video_transcripts')
            .select('full_text, segments, words, duration_seconds')
            .eq('article_id', id)
            .single();

        if (error || !transcript) {
            return res.json({ data: [], message: 'No transcript available for search' });
        }

        // Search
        const results = searchKeyword(
            {
                text: transcript.full_text,
                segments: transcript.segments,
                words: transcript.words,
                duration: transcript.duration_seconds,
            },
            query
        );

        // Format results
        const formatted = results.map(r => ({
            timestamp: r.timestamp,
            timestampFormatted: formatTimestamp(r.timestamp),
            word: r.word,
            context: r.context,
            level: r.level,
        }));

        res.json({
            data: formatted,
            count: formatted.length,
            query,
        });
    } catch (error) {
        log.system.error('Video search failed', { error: error.message });
        res.status(500).json({ error: 'Search failed' });
    }
});

// ── POST /api/test/video/:id/process ─────────────────────────
// Manually trigger video processing for an article
router.post('/:id/process', async (req, res) => {
    try {
        const { id } = req.params;

        // Try content_items first, then articles (backward compat)
        let article;
        const { data: ci } = await supabase
            .from('content_items')
            .select('id, url, matched_keywords, type_metadata')
            .eq('id', id)
            .single();

        if (ci) {
            article = ci;
        } else {
            const { data: art } = await supabase
                .from('articles')
                .select('id, url, matched_keywords')
                .eq('id', id)
                .single();
            if (art) article = { ...art, type_metadata: {} };
        }

        if (!article) {
            return res.status(404).json({ error: 'Content item not found' });
        }

        // Extract video ID from URL
        const videoIdMatch = article.url?.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
        if (!videoIdMatch) {
            return res.status(400).json({ error: 'Not a YouTube video URL' });
        }

        const videoId = videoIdMatch[1];
        const keywords = article.matched_keywords || [];

        // Fire-and-forget
        import('../services/video-processor/pipeline.js')
            .then(m => m.processVideo(videoId, id, keywords))
            .catch(err => log.system.error('Manual video processing failed', { error: err.message }));

        res.json({
            message: 'Video processing started',
            videoId,
            articleId: id,
            keywords,
        });
    } catch (error) {
        log.system.error('Process trigger failed', { error: error.message });
        res.status(500).json({ error: 'Failed to trigger processing' });
    }
});

// ── GET /api/test/video/:id/status ───────────────────────────
// Get processing status for a video
router.get('/:id/status', async (req, res) => {
    try {
        const { id } = req.params;

        // Try content_items first, then articles
        let data;
        const { data: ci } = await supabase
            .from('content_items')
            .select('type_metadata')
            .eq('id', id)
            .single();
        data = ci;

        if (!data) {
            // Check if transcript exists (for articles-only videos)
            const { data: vt } = await supabase
                .from('video_transcripts')
                .select('article_id')
                .eq('article_id', id)
                .single();
            if (vt) return res.json({ status: 'complete', message: 'Transcript available' });
            return res.json({ status: 'unknown' });
        }

        const meta = data.type_metadata || {};
        res.json({
            status: meta.processing_status || 'pending',
            message: meta.processing_message || '',
            updatedAt: meta.processing_updated_at || null,
        });
    } catch (error) {
        res.status(500).json({ error: 'Status check failed' });
    }
});

export default router;
