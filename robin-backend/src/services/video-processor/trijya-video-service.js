// ============================================================
// ROBIN OSINT — TRIJYA-7 Video Pipeline Bridge
// Creates video_pipeline jobs for TRIJYA-7 (residential IP + RTX 4090)
// TRIJYA-7 handles: yt-dlp download + faster-whisper + clip generation + upload
// Render handles: translation, AI summaries, DB save
// ============================================================

import { supabase } from '../../lib/supabase.js';
import { log } from '../../lib/logger.js';

const POLL_INTERVAL_MS = 5000;
const TRIJYA_TIMEOUT_MS = 25 * 60 * 1000; // 25 min (Whisper large-v3-turbo takes 10-15 min on long videos)

/**
 * Submit a video to TRIJYA-7 for full pipeline processing.
 * TRIJYA-7 runs: yt-dlp (residential IP, no bot-block) → faster-whisper (RTX 4090)
 *                → keyword search → clip windows → yt-dlp clip download → Supabase upload
 *
 * Returns {transcript, clips, keywordOccurrences} when complete.
 */
export async function processVideoViaTrijya(videoId, keywords) {
    // ── Check for orphaned completed jobs first ───────────────────────────────
    // If Render restarted while polling, the completed result was orphaned.
    // Recover it instead of re-processing on TRIJYA-7.
    const { data: orphaned } = await supabase
        .from('ai_jobs')
        .select('id, result')
        .eq('type', 'video_pipeline')
        .eq('status', 'completed')
        .eq('payload->>videoId', videoId)
        .not('result', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (orphaned?.result) {
        log.ai.info('♻️ Recovered orphaned completed video job — skipping re-process', {
            videoId, jobId: orphaned.id,
        });
        return orphaned.result;
    }

    // Create the job
    const { data: job, error } = await supabase
        .from('ai_jobs')
        .insert({
            type: 'video_pipeline',
            status: 'pending',
            priority: 3,
            payload: { videoId, keywords },
            expires_at: new Date(Date.now() + TRIJYA_TIMEOUT_MS + 60000).toISOString(),
        })
        .select()
        .single();

    if (error) throw new Error(`Failed to create video_pipeline job: ${error.message}`);

    log.ai.info('📡 Video pipeline job queued for TRIJYA-7', {
        videoId,
        jobId: job.id,
        keywords,
    });

    // Poll until done or timeout
    const deadline = Date.now() + TRIJYA_TIMEOUT_MS;
    let lastStatus = 'pending';
    let pollCount = 0;

    while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
        pollCount++;

        const { data } = await supabase
            .from('ai_jobs')
            .select('status, result, error, worker, started_at')
            .eq('id', job.id)
            .single();

        if (!data) continue;

        // Log transitions only (not every poll)
        if (data.status !== lastStatus) {
            log.ai.info('TRIJYA-7 video job status', {
                videoId, jobId: job.id,
                status: data.status,
                worker: data.worker,
                waitedSeconds: Math.round((pollCount * POLL_INTERVAL_MS) / 1000),
            });
            lastStatus = data.status;
        }

        if (data.status === 'completed') {
            // data.result = { transcript, clips, keywordOccurrences }
            return data.result;
        }

        if (data.status === 'failed') {
            throw new Error(`TRIJYA-7 video pipeline failed: ${data.error}`);
        }
    }

    // Timed out — cancel the job if still pending (don't let it run after we gave up)
    await supabase
        .from('ai_jobs')
        .update({ status: 'failed', error: 'Backend polling timed out after 25 minutes' })
        .eq('id', job.id)
        .eq('status', 'pending');

    throw new Error('TRIJYA-7 video pipeline timed out (25 min) — is the worker running?');
}
