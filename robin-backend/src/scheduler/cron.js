// ============================================================
// ROBIN OSINT — Cron Scheduler
// Scraper every N hours, nightly batch intelligence at 2am,
// daily cleanup at 3am
// ============================================================

import cron from 'node-cron';
import { config } from '../config.js';
import { runScraperCycle } from '../scrapers/orchestrator.js';
import { runKeywordExpansionForAllClients } from '../ai/keyword-expander.js';
import { runClusteringForAllClients } from '../ai/keyword-clusterer.js';
import { translateMissingTitles } from '../ai/title-translator.js';
import { supabase } from '../lib/supabase.js';
import { log } from '../lib/logger.js';

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

    // Daily cleanup at 3am — remove expired patterns and signals
    cron.schedule('0 3 * * *', async () => {
        log.cron.info('[CLEANUP] Running expired data cleanup');
        await runExpiredCleanup();
    });

    // Daily title translation at 4am — catch any articles still missing title_en
    cron.schedule('0 4 * * *', async () => {
        log.cron.info('[TITLE-TRANSLATOR] Running daily missing-title translation');
        try {
            const result = await translateMissingTitles();
            log.cron.info('[TITLE-TRANSLATOR] Done', result);
        } catch (error) {
            log.cron.error('[TITLE-TRANSLATOR] Daily run failed', { error: error.message });
        }
    });

    // Weekly keyword expansion — every Sunday at 2am
    cron.schedule('0 2 * * 0', async () => {
        log.cron.info('[KEYWORD EXPANDER] Running weekly auto keyword expansion');
        try {
            await runKeywordExpansionForAllClients();
        } catch (error) {
            log.cron.error('[KEYWORD EXPANDER] Weekly expansion failed', { error: error.message });
        }
    });

    // Weekly keyword clustering — every Sunday at 3:30am (after expansion at 2am)
    cron.schedule('30 3 * * 0', async () => {
        log.cron.info('[CLUSTERER] Running weekly semantic keyword clustering');
        try {
            await runClusteringForAllClients();
        } catch (error) {
            log.cron.error('[CLUSTERER] Weekly clustering failed', { error: error.message });
        }
    });

    log.cron.info('Scraper: "' + scraperCron + '" | Cleanup: "0 3 * * *" | Keyword expansion: "0 2 * * 0" (weekly) | Batch intel: event-driven post-scrape');
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
