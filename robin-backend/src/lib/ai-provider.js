// ============================================================
// ROBIN OSINT — AI Provider (TRIJYA-7 + Groq Fallback)
// Routes AI jobs to TRIJYA-7 via Supabase queue.
// Falls back to Groq automatically if TRIJYA-7 is offline.
// ============================================================

import { supabase } from './supabase.js';
import { log } from './logger.js';

const JOB_TIMEOUT_MS  = 90000; // Wait 90s for TRIJYA-7 to pick up + process (8b model takes ~35-45s)
const POLL_INTERVAL_MS = 2000; // Poll Supabase every 2s for job status
const JOB_TTL_HOURS   = 24;   // Auto-expire jobs after 24h

// ─── Internal helpers ────────────────────────────────────────

async function createJob(type, payload, priority = 3, clientId = null) {
    const { data, error } = await supabase
        .from('ai_jobs')
        .insert({
            type,
            payload,
            priority,
            client_id: clientId || null,
            status: 'pending',
            expires_at: new Date(Date.now() + JOB_TTL_HOURS * 60 * 60 * 1000).toISOString(),
        })
        .select()
        .single();

    if (error) throw new Error(`ai_jobs insert failed: ${error.message}`);
    return data;
}

async function waitForJob(jobId, timeoutMs = JOB_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

        const { data: job, error } = await supabase
            .from('ai_jobs')
            .select('status, result, error, model_used')
            .eq('id', jobId)
            .single();

        if (error || !job) return null;

        if (job.status === 'completed') return { result: job.result, model_used: job.model_used };
        if (job.status === 'failed')    throw new Error(`Worker failed: ${job.error || 'unknown'}`);
        // pending / processing — keep polling
    }

    return null; // timed out
}

async function cancelJob(jobId) {
    try {
        await supabase
            .from('ai_jobs')
            .update({ status: 'cancelled' })
            .eq('id', jobId)
            .in('status', ['pending', 'processing']);
    } catch { /* ignore */ }
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Analyze an article via TRIJYA-7 GPU worker.
 *
 * Returns the analysis object from TRIJYA-7 if successful.
 * Returns null if TRIJYA-7 is offline, busy, or too slow → caller falls back to Groq.
 *
 * TRIJYA-7 writes to article_analysis directly.
 * Render only needs the result for entity_mentions, embedding, title_en, etc.
 */
export async function analyzeArticleViaQueue(article, keywords, clientName) {
    let jobId = null;

    try {
        const job = await createJob('article_analysis', {
            article_id:  article.id,
            title:       article.title       || '',
            content:     article.content     || '',
            source_name: article.source_name || '',
            client_name: clientName          || '',
            keywords:    Array.isArray(keywords) ? keywords.slice(0, 30) : [],
        }, 3, article.client_id);

        jobId = job.id;
        log.ai.debug(`[AI-PROVIDER] Job created → TRIJYA-7`, { jobId: jobId.slice(0, 8), articleId: article.id });

        const outcome = await waitForJob(jobId);

        if (outcome) {
            log.ai.debug(`[AI-PROVIDER] TRIJYA-7 completed`, { jobId: jobId.slice(0, 8), model: outcome.model_used });
            return outcome; // { result: { analysis, ... }, model_used }
        }

        // Timeout — TRIJYA-7 is offline or GPU occupied
        log.ai.info(`[AI-PROVIDER] TRIJYA-7 timeout (30s) — falling back to Groq`, { jobId: jobId.slice(0, 8) });
        await cancelJob(jobId);
        return null;

    } catch (err) {
        log.ai.warn(`[AI-PROVIDER] Job queue error — falling back to Groq`, { error: err.message?.slice(0, 120) });
        if (jobId) await cancelJob(jobId);
        return null;
    }
}

/**
 * Queue a batch intelligence pass for TRIJYA-7.
 * Returns result object or null (caller falls back to Groq).
 */
export async function batchIntelViaQueue(clientId, pass, data) {
    let jobId = null;

    try {
        const job = await createJob('batch_intel', { client_id: clientId, pass, data }, 5, clientId);
        jobId = job.id;

        // Batch intel can take longer — allow 90s
        const outcome = await waitForJob(jobId, 90000);

        if (outcome) return outcome;

        log.ai.info(`[AI-PROVIDER] Batch intel timeout — falling back to Groq`, { pass });
        await cancelJob(jobId);
        return null;

    } catch (err) {
        log.ai.warn(`[AI-PROVIDER] Batch intel queue error`, { error: err.message?.slice(0, 100) });
        if (jobId) await cancelJob(jobId);
        return null;
    }
}
