// ============================================================
// ROBIN OSINT — Render Background Worker Entry Point
//
// Runs 24/7 on Render's free tier (background workers never sleep).
// Handles everything that needs to keep running continuously:
//   • Scraper cron cycle (every N hours)
//   • AI analysis worker (article enrichment)
//   • DB-driven video queue (polls Supabase every 30s)
//
// The API (index.js) is a separate Web Service — it only serves
// HTTP and has SERVER_ROLE=api which skips these heavy workers.
//
// Supabase is the message bus. The scraper writes `queued` videos
// to content_items; this worker picks them up and processes them.
// ============================================================

import { log } from './lib/logger.js';
import { supabase } from './lib/supabase.js';

log.system.info('🔧 ROBIN Worker starting (Render Background Worker)');
log.system.info('   Role: scraper + video pipeline + analysis');
log.system.info('   Browser scrapers: DISABLED (RENDER_SKIP_BROWSER=true)');

// ── Step 1: Clear stale locks from any previous crash ────────
try {
    await supabase.from('system_state').upsert([
        { key: 'scraper_running',          value: 'false', updated_at: new Date().toISOString() },
        { key: 'batch_intelligence_lock',  value: 'false', updated_at: new Date().toISOString() },
    ]);
    log.system.info('Startup: stale locks cleared');
} catch (e) {
    log.system.warn('Could not clear locks on startup', { error: e.message });
}

// ── Step 2: Recover stalled videos ───────────────────────────
// If the worker restarted mid-processing, some videos will be stuck
// in `processing` status forever. Reset them to `queued` so they
// get picked up again by the DB-driven queue below.
try {
    const STALL_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
    const stalledBefore = new Date(Date.now() - STALL_TIMEOUT_MS).toISOString();

    const { data: stalled } = await supabase
        .from('content_items')
        .select('id, title, type_metadata')
        .eq('content_type', 'video')
        .eq('type_metadata->>processing_status', 'processing')
        .lt('type_metadata->>processing_updated_at', stalledBefore);

    if (stalled && stalled.length > 0) {
        log.system.warn(`Recovering ${stalled.length} stalled video(s) → resetting to queued`);
        for (const v of stalled) {
            await supabase
                .from('content_items')
                .update({
                    type_metadata: {
                        ...v.type_metadata,
                        processing_status: 'queued',
                        processing_message: 'Recovered after worker restart',
                        processing_updated_at: new Date().toISOString(),
                    },
                })
                .eq('id', v.id);
            log.system.info('  ↩ Reset to queued', { title: v.title?.substring(0, 60) });
        }
    } else {
        log.system.info('Startup: no stalled videos found');
    }
} catch (e) {
    log.system.warn('Stall recovery failed (non-fatal)', { error: e.message });
}

// ── Step 3: Start the AI analysis worker ─────────────────────
// Continuously enriches newly scraped articles with Groq AI.
const { startAnalysisWorker } = await import('./ai/analysis-worker.js');
startAnalysisWorker();
log.system.info('✅ Analysis worker started');

// ── Step 4: Start the scraper cron scheduler ─────────────────
// Runs scraping on schedule (every N hours, batch intel at 2am, etc.)
const { startScheduler } = await import('./scheduler/cron.js');
startScheduler();
log.system.info('✅ Scraper scheduler started');

// ── Step 5: DB-driven video processing queue ─────────────────
// Polls Supabase every 30s for videos with processing_status='queued'.
// Processes ONE video at a time. Resilient to worker restarts.
//
// Why DB-driven instead of in-memory?
//   The in-memory queue (video-queue.js) is lost on every restart.
//   On Render, restarts happen on deploys and occasional crashes.
//   DB-driven polling is always consistent with what's actually in Supabase.

const VIDEO_POLL_INTERVAL_MS = 30_000; // 30 seconds
let isProcessingVideo = false;

async function pollAndProcessNextVideo() {
    if (isProcessingVideo) return;

    try {
        // Claim the oldest queued video
        const { data: video } = await supabase
            .from('content_items')
            .select('id, url, matched_keywords, type_metadata, title')
            .eq('content_type', 'video')
            .eq('type_metadata->>processing_status', 'queued')
            .order('created_at', { ascending: true })
            .limit(1)
            .single();

        if (!video) return; // Nothing queued

        // Extract YouTube video ID from URL
        const videoIdMatch = video.url?.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
        if (!videoIdMatch) {
            log.ai.warn('DB queue: skipping video with invalid URL', { id: video.id, url: video.url });
            await supabase.from('content_items').update({
                type_metadata: {
                    ...video.type_metadata,
                    processing_status: 'failed',
                    processing_message: 'Invalid YouTube URL',
                    processing_updated_at: new Date().toISOString(),
                },
            }).eq('id', video.id);
            return;
        }

        const ytVideoId = videoIdMatch[1];
        const keywords = Array.isArray(video.matched_keywords)
            ? video.matched_keywords
            : (typeof video.matched_keywords === 'string'
                ? video.matched_keywords.split(',').map(k => k.trim()).filter(Boolean)
                : []);

        log.ai.info('📥 DB queue: picked up video', {
            title: video.title?.substring(0, 60),
            ytVideoId,
            keywords: keywords.slice(0, 3),
        });

        isProcessingVideo = true;

        // Mark as processing immediately (prevents double-claim if poller fires again)
        await supabase.from('content_items').update({
            type_metadata: {
                ...video.type_metadata,
                processing_status: 'processing',
                processing_message: 'Starting pipeline...',
                processing_updated_at: new Date().toISOString(),
            },
        }).eq('id', video.id);

        // Run the full pipeline
        const { processVideo } = await import('./services/video-processor/pipeline.js');
        await processVideo(ytVideoId, video.id, keywords);

        log.ai.info('✅ DB queue: video complete', { ytVideoId });

    } catch (err) {
        // Non-fatal — log and continue polling
        log.ai.error('DB queue: poll/process error', { error: err.message?.substring(0, 150) });
    } finally {
        isProcessingVideo = false;
    }
}

// Start polling immediately, then every 30s
await pollAndProcessNextVideo();
setInterval(pollAndProcessNextVideo, VIDEO_POLL_INTERVAL_MS);

log.system.info('✅ DB-driven video queue polling started (every 30s)');
log.system.info('');
log.system.info('🟢 ROBIN Worker fully operational');
log.system.info('   Scraper:  cron-scheduled');
log.system.info('   Analyzer: continuous');
log.system.info('   Video:    DB-polled every 30s');
