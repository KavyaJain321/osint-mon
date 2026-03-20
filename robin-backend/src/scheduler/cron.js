// ============================================================
// ROBIN OSINT — Cron Scheduler
// Scraper every N hours, nightly batch intelligence at 2am,
// daily cleanup at 3am
// ============================================================

import cron from 'node-cron';
import { config } from '../config.js';
import { runScraperCycle } from '../scrapers/orchestrator.js';
import { supabase } from '../lib/supabase.js';
import { log } from '../lib/logger.js';
import { getJobStatus } from '../services/newspaper-intel-client.js';

// Lazy import to break circular dependency
let runBatchIntelligence;

/**
 * Start the cron scheduler.
 * Currently DISABLED — manual-only mode for development.
 * To re-enable, set CRON_ENABLED to true below.
 */
export function startScheduler() {
    const hours = config.scraperIntervalHours;

    // ── ENABLED: All cron jobs (scraper, nightly batch, cleanup) ──
    // Scraping runs automatically + on-demand from brief submission.
    const CRON_ENABLED = true;

    if (!CRON_ENABLED) {
        log.cron.info('Cron scheduler DISABLED (manual-only mode). Hours setting: ' + hours);
        return;
    }

    const scraperCron = '0 */' + hours + ' * * *';
    log.cron.info('Cron scheduler starting. Scraper runs every ' + hours + ' hours.');

    // Schedule scraper cycle
    cron.schedule(scraperCron, async () => {
        log.cron.info('Triggering scheduled scraper cycle');
        try {
            await runScraperCycle();
        } catch (error) {
            log.cron.error('Scheduled scraper failed', { error: error.message });
        }
    });

    // Schedule nightly batch intelligence at 2am
    cron.schedule('0 2 * * *', async () => {
        log.cron.info('Triggering nightly batch intelligence');
        try {
            if (!runBatchIntelligence) {
                const mod = await import('../ai/batch-intelligence.js');
                runBatchIntelligence = mod.runBatchIntelligence;
            }
            await runBatchIntelligence();
        } catch (error) {
            log.cron.error('Nightly batch failed', { error: error.message });
        }
    });

    // Daily cleanup at 3am — remove expired patterns and signals
    cron.schedule('0 3 * * *', async () => {
        log.cron.info('[CLEANUP] Running expired data cleanup');
        await runExpiredCleanup();
    });

    // Newspaper job poller — every 30 seconds (only if service is configured)
    // node-cron supports 6-field patterns: second minute hour day month weekday
    if (config.hasNewspaperIntel) {
        cron.schedule('*/30 * * * * *', async () => {
            await pollNewspaperJobs();
        });
        log.cron.info('Newspaper job poller scheduled (every 30s)');
    }

    log.cron.info('Scraper: "' + scraperCron + '" | Batch: "0 2 * * *" | Cleanup: "0 3 * * *"');
}

/**
 * Poll all pending newspaper extraction jobs and sync their status.
 * Articles are already written to content_items by the newspaper-intel-service —
 * this just marks jobs done and records match counts in brief_newspaper_jobs.
 * Runs every 30s; skips gracefully if service is not configured.
 */
export async function pollNewspaperJobs() {
    if (!config.hasNewspaperIntel) return;

    try {
        const { data: pendingJobs, error: fetchErr } = await supabase
            .from('brief_newspaper_jobs')
            .select('*')
            .eq('status', 'pending');

        if (fetchErr) {
            log.cron.warn('[newspaper_poller] Failed to fetch pending jobs', { error: fetchErr.message });
            return;
        }

        if (!pendingJobs?.length) return;

        log.cron.info(`[newspaper_poller] Checking ${pendingJobs.length} pending job(s)`);

        for (const job of pendingJobs) {
            try {
                const statusData = await getJobStatus(job.job_id);

                if (!statusData) {
                    // Job not found in the service — mark as failed
                    await supabase.from('brief_newspaper_jobs').update({
                        status:     'failed',
                        error:      'Job not found in newspaper-intel-service',
                        updated_at: new Date().toISOString(),
                    }).eq('job_id', job.job_id);
                    continue;
                }

                const { status } = statusData;

                if (status === 'completed') {
                    const result     = statusData.result || {};
                    const matchCount = result.total_matches ?? 0;

                    await supabase.from('brief_newspaper_jobs').update({
                        status:      'completed',
                        match_count: matchCount,
                        updated_at:  new Date().toISOString(),
                    }).eq('job_id', job.job_id);

                    log.cron.info('[newspaper_poller] Job completed', {
                        jobId:      job.job_id,
                        sourceName: job.source_name,
                        briefId:    job.brief_id,
                        matchCount,
                    });

                } else if (status === 'failed') {
                    const errorMsg = statusData.result?.error || statusData.error || 'unknown';

                    await supabase.from('brief_newspaper_jobs').update({
                        status:     'failed',
                        error:      String(errorMsg).substring(0, 500),
                        updated_at: new Date().toISOString(),
                    }).eq('job_id', job.job_id);

                    log.cron.warn('[newspaper_poller] Job failed', {
                        jobId:      job.job_id,
                        sourceName: job.source_name,
                        briefId:    job.brief_id,
                        error:      errorMsg,
                    });
                }
                // status === 'queued' | 'processing' → leave as pending, check next tick

            } catch (jobErr) {
                log.cron.error('[newspaper_poller] Error checking job', {
                    jobId: job.job_id,
                    error: jobErr.message,
                });
            }
        }
    } catch (err) {
        log.cron.error('[newspaper_poller] Unexpected error', { error: err.message });
    }
}

/**
 * Clean up expired intelligence patterns and signals.
 * Can be called manually or by cron.
 */
export async function runExpiredCleanup() {
    const now = new Date().toISOString();
    let patternsDeleted = 0;
    let signalsDeleted = 0;

    // 1. Clean old narrative_patterns (older than 30 days)
    try {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
        const { data, error } = await supabase
            .from('narrative_patterns')
            .delete()
            .lt('pattern_date', thirtyDaysAgo)
            .select('id');

        if (error) {
            log.cron.warn('[CLEANUP] Pattern cleanup failed', { error: error.message });
        } else {
            patternsDeleted = data?.length ?? 0;
        }
    } catch (err) {
        log.cron.warn('[CLEANUP] Pattern cleanup error', { error: err.message });
    }

    // 2. Clean expired intelligence_signals
    try {
        const { data, error } = await supabase
            .from('intelligence_signals')
            .delete()
            .lt('expires_at', now)
            .select('id');

        if (error) {
            log.cron.warn('[CLEANUP] Signal cleanup failed', { error: error.message });
        } else {
            signalsDeleted = data?.length ?? 0;
        }
    } catch (err) {
        log.cron.warn('[CLEANUP] Signal cleanup error', { error: err.message });
    }

    log.cron.info('[CLEANUP] Expired data removed', { patternsDeleted, signalsDeleted });
    return { patternsDeleted, signalsDeleted };
}

/**
 * Trigger a scrape cycle immediately (used by API endpoint).
 */
export async function triggerScrapeNow() {
    log.cron.info('Manual scrape trigger received');
    await runScraperCycle();
}
