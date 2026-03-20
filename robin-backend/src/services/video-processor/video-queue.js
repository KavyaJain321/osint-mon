// ============================================================
// ROBIN OSINT — Sequential Video Processing Queue
// Processes one video at a time to avoid exhausting Groq API
// rate limits. All channels share a single global queue.
// ============================================================

import { log } from '../../lib/logger.js';

// ── Queue state (module-level singleton) ─────────────────────
const queue = [];          // [{ videoId, articleId, keywords, title }]
let isProcessing = false;

// Delay between videos (lets Groq rate-limit window recover)
const BETWEEN_VIDEO_DELAY_MS = 3000; // 3 seconds

// ── Public API ───────────────────────────────────────────────

/**
 * Add a video to the processing queue.
 * If the queue is idle, processing starts immediately.
 * Otherwise the video waits its turn.
 *
 * @param {string} videoId       YouTube video ID
 * @param {string} articleId     Supabase content_items/articles ID
 * @param {string[]} keywords    Matched keywords for this video
 * @param {string} [title]       Video title (for logging only)
 */
export function enqueueVideo(videoId, articleId, keywords, title = '') {
    queue.push({ videoId, articleId, keywords, title });

    log.ai.info('📥 Video enqueued', {
        videoId,
        title: title.substring(0, 60),
        position: queue.length,
        queueLength: queue.length,
    });

    // Kick off processing if queue was idle
    if (!isProcessing) {
        processNext();
    }
}

/**
 * Returns current queue status (for status endpoints / logs).
 */
export function getQueueStatus() {
    return {
        isProcessing,
        queueLength: queue.length,
        pending: queue.map(v => ({ videoId: v.videoId, title: v.title.substring(0, 50) })),
    };
}

// ── Internal ─────────────────────────────────────────────────

async function processNext() {
    if (queue.length === 0) {
        isProcessing = false;
        log.ai.info('✅ Video queue empty — all done');
        return;
    }

    isProcessing = true;
    const item = queue.shift();
    const { videoId, articleId, keywords, title } = item;

    log.ai.info(`▶️  Processing video ${queue.length + 1 - queue.length} | ${queue.length} remaining in queue`, {
        videoId,
        title: title.substring(0, 60),
        remainingInQueue: queue.length,
    });

    try {
        const { processVideo } = await import('./pipeline.js');
        await processVideo(videoId, articleId, keywords);
    } catch (err) {
        log.ai.error('❌ Video queue: pipeline error', {
            videoId,
            error: err.message?.substring(0, 150),
        });
    }

    // Wait between videos so Groq rate limits can recover
    if (queue.length > 0) {
        log.ai.info(`⏸  Waiting ${BETWEEN_VIDEO_DELAY_MS / 1000}s before next video | ${queue.length} remaining`, { videoId });
        await new Promise(r => setTimeout(r, BETWEEN_VIDEO_DELAY_MS));
    }

    // Process next in sequence
    processNext();
}
