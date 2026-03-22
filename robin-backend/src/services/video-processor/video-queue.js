// ============================================================
// ROBIN OSINT — DB-Driven Video Processing Queue
//
// Polls Supabase every 30s for videos with processing_status='queued'.
// Processes one video at a time (sequential, Groq-safe).
// Survives server restarts — state lives in the DB, not in memory.
// cron.org keeps the Render free-tier service alive every 10 min.
// ============================================================

import { log } from '../../lib/logger.js';
import { supabase } from '../../lib/supabase.js';

let isProcessing = false;
let pollerStarted = false;

const POLL_INTERVAL_MS    = 30_000; // Check DB for queued videos every 30s
const BETWEEN_VIDEO_DELAY = 5_000;  // Gap between videos (Groq rate-limit recovery)

// ── Public: start the background DB poller ───────────────────
// Called once from index.js at server startup.
// Picks up any videos stuck in 'queued' state from before a restart.
export function startQueuePoller() {
    if (pollerStarted) return;
    pollerStarted = true;
    log.ai.info('🔄 DB-driven video queue poller started (30s interval)');

    // Run once shortly after startup to pick up any stuck queued videos
    setTimeout(() => pickAndProcess(), 8000);

    // Then poll on a regular interval
    setInterval(async () => {
        if (!isProcessing) await pickAndProcess();
    }, POLL_INTERVAL_MS);
}

// ── Public: signal that a new video was just saved as 'queued' ─
// The youtube-crawler sets processing_status='queued' before calling this.
// We just kick the poller immediately instead of waiting up to 30s.
export function enqueueVideo(videoId, articleId, keywords, title = '') {
    log.ai.info('📥 Video queued in DB', {
        videoId,
        title: title.substring(0, 60),
    });

    // Kick the poller immediately (1s delay so the DB write settles)
    if (!isProcessing) {
        setTimeout(() => pickAndProcess(), 1000);
    }
}

// ── Public: status (for /scraper-status endpoint) ────────────
export function getQueueStatus() {
    return {
        isProcessing,
        queueLength: 'DB-driven — see processing_status in content_items',
        pending: [],
    };
}

// ── Internal: claim one queued video and process it ──────────
async function pickAndProcess() {
    if (isProcessing) return;

    try {
        // Find the oldest video that is still waiting
        const { data: videos, error } = await supabase
            .from('content_items')
            .select('id, url, matched_keywords, title, type_metadata')
            .eq('content_type', 'video')
            .eq('type_metadata->>processing_status', 'queued')
            .order('created_at', { ascending: true })
            .limit(1);

        if (error) {
            log.ai.error('DB queue poll error', { error: error.message });
            return;
        }

        if (!videos?.length) return; // Nothing to do

        const video = videos[0];

        // Extract YouTube video ID from the stored URL
        const videoIdMatch = video.url?.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
        if (!videoIdMatch) {
            await supabase.from('content_items').update({
                type_metadata: {
                    ...video.type_metadata,
                    processing_status: 'skipped',
                    processing_message: 'Cannot extract YouTube video ID from URL',
                    processing_updated_at: new Date().toISOString(),
                },
            }).eq('id', video.id);
            return;
        }

        const videoId = videoIdMatch[1];
        const keywords = video.matched_keywords || [];

        // ── Atomic claim: only transition if STILL 'queued' ──────
        // Guards against double-processing (e.g. on manual retrigger)
        const { data: claimed } = await supabase
            .from('content_items')
            .update({
                type_metadata: {
                    ...video.type_metadata,
                    processing_status: 'processing',
                    processing_message: 'Starting transcription...',
                    processing_updated_at: new Date().toISOString(),
                },
            })
            .eq('id', video.id)
            .eq('type_metadata->>processing_status', 'queued')
            .select('id');

        if (!claimed?.length) {
            // Race condition — another process already claimed it. Skip.
            return;
        }

        // ── Process ───────────────────────────────────────────────
        isProcessing = true;
        log.ai.info('▶️  Processing video from DB queue', {
            videoId,
            articleId: video.id,
            title: video.title?.substring(0, 60),
            keywords: keywords.slice(0, 5),
        });

        try {
            const { processVideo } = await import('./pipeline.js');
            await processVideo(videoId, video.id, keywords);
        } catch (err) {
            log.ai.error('❌ DB queue: pipeline error', {
                videoId,
                error: err.message?.substring(0, 200),
            });

            // BUG FIX #6: On pipeline failure the status previously remained
            // 'processing' forever — the poller only picks up 'queued' items,
            // so the video was silently stuck and never retried or surfaced.
            // Explicitly mark it 'failed' so operators can see and retry it.
            try {
                await supabase.from('content_items').update({
                    type_metadata: {
                        ...video.type_metadata,
                        processing_status: 'failed',
                        processing_message: err.message?.substring(0, 300) || 'Unknown pipeline error',
                        processing_updated_at: new Date().toISOString(),
                    },
                }).eq('id', video.id);
            } catch (updateErr) {
                log.ai.error('DB queue: could not mark video as failed', { videoId, error: updateErr.message });
            }
        }

        // Brief cooldown so Groq rate-limit window can recover
        await new Promise(r => setTimeout(r, BETWEEN_VIDEO_DELAY));

        isProcessing = false;

        // Immediately check if another video is waiting
        await pickAndProcess();

    } catch (err) {
        isProcessing = false;
        log.ai.error('DB queue poller unexpected error', { error: err.message });
    }
}
