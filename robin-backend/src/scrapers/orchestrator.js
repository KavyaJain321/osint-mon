// ============================================================
// ROBIN OSINT — Scraper Orchestrator
// Coordinates all crawlers across all clients
// Includes fallback chain: rss → html → browser
// ============================================================

import { supabase } from '../lib/supabase.js';
import { log } from '../lib/logger.js';
import { crawlRssSource } from './rss-crawler.js';
import { crawlHtmlSource } from './html-crawler.js';
import { crawlBrowserSource } from './browser-crawler.js';
import { crawlPdfSource } from './pdf-crawler.js';
import { crawlYoutubeSource } from './youtube-crawler.js';
import { scrapeGoogleNews } from './gnews-crawler.js';
import { scrapeReddit } from './reddit-crawler.js';
import { runYoutubeKeywordSearch } from './youtube-search-crawler.js';
import { saveContent } from '../services/content-saver.js';
import { buildTopicWords } from '../services/keyword-matcher.js';
import { runTemporalAnalysis } from '../ai/temporal-analyzer.js';
import { updatePipelineStage } from '../lib/pipeline-tracker.js';

const SCRAPER_LOCK_KEY = 'scraper_running';
const LOCK_TIMEOUT_HOURS = 0.5; // 30 minutes — scrapes typically complete in 10-20 min

const RSS_CONCURRENCY = 2;
const HTML_CONCURRENCY = 1;  // keep at 1 — jsdom is memory-heavy
const PDF_CONCURRENCY = 1;
const YOUTUBE_CONCURRENCY = 1;

// Max HTML sources per cycle — prevents OOM crashes and 30+ minute scrape runs.
// Sources rotate across hourly cron cycles so all 480+ get covered over time.
const MAX_HTML_PER_CYCLE = 10;

// Fallback chain: when primary crawler fails, try the next type.
// On Render (RENDER_SKIP_BROWSER=true), browser is excluded from all fallbacks.
const FALLBACK_CHAIN = process.env.RENDER_SKIP_BROWSER === 'true'
    ? { rss: ['html'], html: [] }      // No browser fallback on Render (saves 250MB RAM)
    : { rss: ['html', 'browser'], html: ['browser'] };

/**
 * Acquire the scraper lock with TOCTOU-safe logic.
 * BUG FIX #21: The original code used a separate read then write — two round-trips —
 * leaving a window where two processes could both read 'false' and both acquire the lock.
 * Fix: read current state first, check the stale-lock timeout, and only upsert to 'true'
 * if we determine it is safe. In a single-process Node.js deploy (current Render setup)
 * this is sufficient. For truly distributed deploys, migrate to a DB-level advisory lock.
 * @returns {Promise<boolean>} true if lock acquired
 */
async function acquireLock() {
    try {
        const { data: existing } = await supabase
            .from('system_state')
            .select('value, updated_at')
            .eq('key', SCRAPER_LOCK_KEY)
            .single();

        if (existing && existing.value === 'true') {
            const lockedAt = new Date(existing.updated_at);
            const hoursSince = (Date.now() - lockedAt.getTime()) / (1000 * 60 * 60);

            if (hoursSince < LOCK_TIMEOUT_HOURS) {
                log.scraper.warn('Scraper lock active, skipping', { lockedMinutesAgo: Math.round(hoursSince * 60) });
                return false;
            }
            log.scraper.warn('Overriding stale scraper lock', { hours: hoursSince.toFixed(1) });
        }

        // Upsert to 'true'. In single-process deploys the read-then-upsert is safe
        // because Node.js is single-threaded and there is only one process running.
        const { error } = await supabase.from('system_state').upsert({
            key: SCRAPER_LOCK_KEY,
            value: 'true',
            updated_at: new Date().toISOString(),
        }, { onConflict: 'key' });

        if (error) throw error;
        return true;
    } catch (error) {
        log.scraper.error('Failed to acquire lock', { error: error.message });
        return false;
    }
}

/**
 * Update source health after each crawl attempt.
 * Success → reset failure counter, mark healthy.
 * Failure → increment counter; auto-disable at 15 consecutive failures.
 * Non-blocking — never interrupts the main scrape flow.
 */
async function updateSourceHealth(sourceId, success, failureReason = null) {
    try {
        if (success) {
            await supabase.from('sources').update({
                consecutive_failures: 0,
                last_success_at: new Date().toISOString(),
                last_failure_reason: null,
                health_status: 'healthy',
            }).eq('id', sourceId);
            return;
        }

        // Fetch current failure count
        const { data: src } = await supabase
            .from('sources')
            .select('consecutive_failures, health_status, name, url')
            .eq('id', sourceId)
            .single();

        if (!src) return;

        const newFailures = (src.consecutive_failures || 0) + 1;
        const newStatus = newFailures >= 15 ? 'dead'
            : newFailures >= 5 ? 'degraded'
            : (src.health_status || 'healthy');

        const update = {
            consecutive_failures: newFailures,
            last_failure_reason: (failureReason || 'Unknown error').slice(0, 500),
            health_status: newStatus,
        };

        // Auto-disable after 15 consecutive failures
        if (newFailures === 15) {
            update.is_active = false;
            update.auto_disabled_at = new Date().toISOString();
            log.scraper.warn('Source auto-disabled after 15 consecutive failures', {
                sourceId, name: src.name, url: src.url, reason: failureReason,
            });
        } else if (newFailures === 5) {
            log.scraper.warn('Source degraded — 5 consecutive failures', {
                sourceId, name: src.name, url: src.url,
            });
        }

        await supabase.from('sources').update(update).eq('id', sourceId);
    } catch (err) {
        // Health tracking must never break the scrape cycle
        log.scraper.warn('Source health update failed (non-blocking)', { sourceId, error: err.message });
    }
}

/**
 * Release the scraper lock.
 */
async function releaseLock() {
    try {
        await supabase.from('system_state').upsert({
            key: SCRAPER_LOCK_KEY,
            value: 'false',
            updated_at: new Date().toISOString(),
        });
    } catch (error) {
        log.scraper.error('Failed to release lock', { error: error.message });
    }
}

/**
 * Helper: get keywords for a client from their active brief.
 */
async function getClientKeywords(clientId) {
    const { data: activeBrief } = await supabase
        .from('client_briefs')
        .select('id')
        .eq('client_id', clientId)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    if (!activeBrief) return [];

    const { data: keywords } = await supabase
        .from('brief_generated_keywords')
        .select('keyword')
        .eq('brief_id', activeBrief.id)
        .limit(100);

    return (keywords || []).map((k) => k.keyword);
}

/**
 * Fetch all active sources with their client's keywords.
 * @param {string|null} filterClientId - When provided, only fetch sources for this client.
 * @returns {Promise<Array>} Sources with keywords
 */
async function fetchAllActiveSources(filterClientId = null) {
    // BUG FIX #22: Warn operators when the 500-source hard cap is likely to silently
    // drop sources rather than scraping them all.
    let query = supabase
        .from('sources')
        .select('id, client_id, name, url, source_type, last_scraped_at')
        .eq('is_active', true)
        .limit(500);

    // BUG FIX #11: Apply client filter when triggered for a specific client.
    if (filterClientId) query = query.eq('client_id', filterClientId);

    const { data: sources, error } = await query;

    if (error) throw new Error(`Failed to fetch sources: ${error.message}`);
    if (!sources || sources.length === 0) return [];

    // BUG FIX #22: Warn when the 500-source limit may have silently dropped sources.
    if (sources.length === 500) {
        log.scraper.warn('Source fetch hit the 500-row limit — some sources may have been skipped. Consider paginating or raising the limit.');
    }

    // Fetch keywords for each unique client from active brief
    const clientIds = [...new Set(sources.map((s) => s.client_id))];
    const keywordMap = {};
    const topicWordMap = {}; // broad topic words per client
    const clientsWithActiveBrief = new Set();

    const keywordResults = await Promise.all(
        clientIds.map(id => getClientKeywords(id))
    );

    clientIds.forEach((id, i) => {
        keywordMap[id] = keywordResults[i];
        if (keywordResults[i].length > 0) {
            clientsWithActiveBrief.add(id);
            topicWordMap[id] = buildTopicWords(keywordResults[i]);
        }
    });

    log.scraper.info('Keywords loaded from active briefs', {
        clients: clientIds.length,
        totalKeywords: Object.values(keywordMap).reduce((sum, kws) => sum + kws.length, 0),
        clientsWithBrief: clientsWithActiveBrief.size,
        sampleTopicWords: topicWordMap[clientIds[0]] ? [...topicWordMap[clientIds[0]]].slice(0, 10).join(', ') : '',
    });

    return sources.map((s) => ({
        ...s,
        keywords: keywordMap[s.client_id] || [],
        briefSource: clientsWithActiveBrief.has(s.client_id),
        topicWords: topicWordMap[s.client_id] || new Set(),
    }));
}

/**
 * Process a batch of sources with concurrency limit.
 */
async function processBatch(sources, crawlFn, concurrency) {
    const results = [];

    for (let i = 0; i < sources.length; i += concurrency) {
        const batch = sources.slice(i, i + concurrency);
        const batchResults = await Promise.allSettled(
            batch.map((source) => crawlFn(source, source.keywords))
        );

        for (const r of batchResults) {
            if (r.status === 'fulfilled') {
                results.push(r.value);
            } else {
                log.scraper.error('Crawler threw unhandled error', {
                    reason: r.reason?.message || String(r.reason)
                });
            }
        }

        // Force GC between batches to prevent OOM on Render free tier (512MB)
        if (global.gc) global.gc();
    }

    return results;
}

/**
 * Get the crawl function for a given source type.
 * @param {string} sourceType
 * @returns {Function|null}
 */
function getCrawlFunction(sourceType) {
    switch (sourceType) {
        case 'rss': return crawlRssSource;
        case 'html': return crawlHtmlSource;
        case 'browser': return crawlBrowserSource;
        case 'pdf': return crawlPdfSource;
        case 'youtube': return crawlYoutubeSource;
        case 'google_news': return crawlGoogleNewsWrapper;
        case 'reddit': return crawlRedditWrapper;
        // Newspaper sources are handled exclusively by the newspaper-intel-service
        // microservice (triggered via brief activation). The orchestrator skips them
        // to prevent overlap with the OCR/fuzzy-match pipeline.
        case 'newspaper': return null;
        default: return null;
    }
}

// Wrapper for Google News → uses content-saver instead of article-saver
async function crawlGoogleNewsWrapper(source, keywords) {
    const items = await scrapeGoogleNews(source, source.client_id, keywords);
    let saved = 0;
    const errors = [];
    for (const item of items) {
        try {
            const result = await saveContent(item);
            if (result.saved) saved++;
        } catch (e) {
            errors.push({ error: e.message });
        }
    }
    const failed = items.length === 0 && errors.length > 0;
    updateSourceHealth(source.id, !failed, failed ? errors[0]?.error : null).catch(() => {});
    return { sourceId: source.id, articlesFound: items.length, articlesSaved: saved, errors };
}

// Wrapper for Reddit → uses content-saver
async function crawlRedditWrapper(source, keywords) {
    const items = await scrapeReddit(source, source.client_id, keywords);
    let saved = 0;
    const errors = [];
    for (const item of items) {
        try {
            const result = await saveContent(item);
            if (result.saved) saved++;
        } catch (e) {
            errors.push({ error: e.message });
        }
    }
    const failed = items.length === 0 && errors.length > 0;
    updateSourceHealth(source.id, !failed, failed ? errors[0]?.error : null).catch(() => {});
    return { sourceId: source.id, articlesFound: items.length, articlesSaved: saved, errors };
}

/**
 * Crawl a source with automatic fallback chain.
 * If the primary crawler fails (0 articles + errors), try the next type.
 * Fallback order: rss → html → browser
 * @param {Object} source - Source record
 * @param {string[]} keywords - Watch keywords
 * @returns {Promise<Object>} Crawl result
 */
async function crawlWithFallback(source, keywords) {
    const primaryType = source.source_type;
    const crawlFn = getCrawlFunction(primaryType);

    if (!crawlFn) {
        log.scraper.error('Unknown source type', { type: primaryType, source: source.name });
        return { sourceId: source.id, articlesFound: 0, articlesSaved: 0, errors: [{ error: `Unknown type: ${primaryType}` }] };
    }

    // Try primary crawler
    let result;
    try {
        result = await crawlFn(source, keywords);
    } catch (err) {
        log.scraper.error('Primary crawler threw', { source: source.name, error: err.message });
        result = { sourceId: source.id, articlesFound: 0, articlesSaved: 0, errors: [{ error: err.message }] };
    }

    // Check if primary failed (has errors AND found 0 articles)
    const primaryFailed = result.errors.length > 0 && result.articlesFound === 0;
    const fallbacks = FALLBACK_CHAIN[primaryType] || [];

    if (!primaryFailed || fallbacks.length === 0) {
        // Primary succeeded (or no fallbacks to try)
        if (!primaryFailed) updateSourceHealth(source.id, true).catch(() => {});
        else updateSourceHealth(source.id, false, result.errors[0]?.error).catch(() => {});
        return result;
    }

    // Try fallback crawlers
    for (const fallbackType of fallbacks) {
        log.scraper.info('Attempting fallback crawler', {
            source: source.name || source.url,
            from: primaryType,
            to: fallbackType,
        });

        const fallbackFn = getCrawlFunction(fallbackType);
        if (!fallbackFn) continue;

        try {
            const fallbackResult = await fallbackFn(source, keywords);

            if (fallbackResult.articlesFound > 0 || fallbackResult.errors.length === 0) {
                log.scraper.info('Fallback succeeded', {
                    source: source.name || source.url,
                    type: fallbackType,
                    found: fallbackResult.articlesFound,
                    saved: fallbackResult.articlesSaved,
                });
                updateSourceHealth(source.id, true).catch(() => {});
                return fallbackResult;
            }
        } catch (error) {
            log.scraper.warn('Fallback crawler also failed', {
                source: source.name || source.url,
                type: fallbackType,
                error: error.message,
            });
        }
    }

    // All fallbacks failed — return original result
    log.scraper.warn('All crawlers failed for source', {
        source: source.name || source.url,
        tried: [primaryType, ...fallbacks],
    });
    const firstError = result.errors[0]?.error || 'All crawlers failed';
    updateSourceHealth(source.id, false, firstError).catch(() => {});
    return result;
}

/**
 * Run a complete scraper cycle across all clients and sources.
 * @param {string|null} filterClientId - When provided, only scrape sources for this client (admin manual trigger).
 */
export async function runScraperCycle(filterClientId = null) {
    const startTime = Date.now();
    log.scraper.info('=== Scraper cycle started ===', filterClientId ? { filterClientId } : {});

    // Hint to GC before starting heavy scrape cycle
    if (global.gc) {
        global.gc();
        log.scraper.info('GC triggered before scrape cycle');
    }

    const locked = await acquireLock();
    if (!locked) return;

    try {
        const sources = await fetchAllActiveSources(filterClientId);
        if (sources.length === 0) {
            log.scraper.info('No active sources found', filterClientId ? { filterClientId } : {});
            return;
        }

        // Group sources by type
        const rssSources = sources.filter((s) => s.source_type === 'rss');
        const htmlSources = sources.filter((s) => s.source_type === 'html');
        const browserSources = sources.filter((s) => s.source_type === 'browser');
        const pdfSources = sources.filter((s) => s.source_type === 'pdf');
        const youtubeSources = sources.filter((s) => s.source_type === 'youtube');
        const gnewsSources = sources.filter((s) => s.source_type === 'google_news');
        const redditSources = sources.filter((s) => s.source_type === 'reddit');

        // Newspaper sources are skipped — handled by newspaper-intel-service microservice
        const newspaperSources = sources.filter((s) => s.source_type === 'newspaper');
        if (newspaperSources.length > 0) {
            log.scraper.info(`Skipping ${newspaperSources.length} newspaper source(s) — handled by newspaper-intel-service`);
        }

        log.scraper.info('Sources to crawl', {
            rss: rssSources.length,
            html: htmlSources.length,
            browser: browserSources.length,
            pdf: pdfSources.length,
            youtube: youtubeSources.length,
            google_news: gnewsSources.length,
            reddit: redditSources.length,
        });

        // Process RSS with fallback chain (parallel, concurrency 5)
        await updatePipelineStage('scraping', `Scraping RSS sources (0/${rssSources.length})...`, { phase: 'rss', total: sources.length });
        const rssResults = await processBatch(rssSources, crawlWithFallback, RSS_CONCURRENCY);

        // Process HTML (parallel, concurrency 5)
        // Cap to MAX_HTML_PER_CYCLE, prioritising least-recently-scraped so all
        // sources rotate across the hourly cron runs rather than only the first 100.
        const htmlSourcesSorted = htmlSources
            .sort((a, b) => {
                const dateA = a.last_scraped_at ? new Date(a.last_scraped_at).getTime() : 0;
                const dateB = b.last_scraped_at ? new Date(b.last_scraped_at).getTime() : 0;
                return dateA - dateB; // oldest first
            })
            .slice(0, MAX_HTML_PER_CYCLE);
        log.scraper.info('HTML sources selected for this cycle', { total: htmlSources.length, selected: htmlSourcesSorted.length });
        await updatePipelineStage('scraping', `Scraping HTML sources (${rssResults.length} RSS done)...`, { phase: 'html', rssComplete: rssResults.length });
        // BUG FIX #32: Was calling crawlHtmlSource directly, bypassing browser fallback.
        // crawlWithFallback tries HTML first then escalates to browser for JS-heavy pages.
        const htmlResults = await processBatch(htmlSourcesSorted, crawlWithFallback, HTML_CONCURRENCY);

        // Process PDF (parallel, concurrency 2)
        // Skipped on Render free tier: PDF crawler uses Chromium (same RAM concern as browser)
        const pdfResults = process.env.RENDER_SKIP_BROWSER === 'true'
            ? (pdfSources.length > 0 && log.scraper.info(`Skipping ${pdfSources.length} PDF source(s) — RENDER_SKIP_BROWSER=true`), [])
            : await processBatch(pdfSources, crawlPdfSource, PDF_CONCURRENCY);

        // Process YouTube (parallel, concurrency 3)
        await updatePipelineStage('scraping', 'Scraping YouTube & browser sources...', { phase: 'youtube' });
        const youtubeResults = await processBatch(youtubeSources, crawlYoutubeSource, YOUTUBE_CONCURRENCY);

        // NEW: YouTube keyword search — discovers additional videos from ANY channel
        // Build clientKeywordMap from sources data
        const clientKeywordMap = {};
        for (const src of sources) {
            if (!clientKeywordMap[src.client_id] && src.keywords?.length > 0) {
                clientKeywordMap[src.client_id] = { keywords: src.keywords, clientId: src.client_id };
            }
        }
        let ytSearchResults = { totalFound: 0, totalSaved: 0, errors: [] };
        try {
            await updatePipelineStage('scraping', 'YouTube keyword search (discovering new videos)...', { phase: 'youtube_search' });
            ytSearchResults = await runYoutubeKeywordSearch(clientKeywordMap);
            log.scraper.info('YouTube keyword search done', { found: ytSearchResults.totalFound, saved: ytSearchResults.totalSaved });
        } catch (ytSearchErr) {
            log.scraper.warn('YouTube keyword search failed (non-blocking)', { error: ytSearchErr.message });
        }

        // Process Browser (SEQUENTIAL — memory intensive)
        // Skipped on Render free tier: Chromium needs ~250MB which exhausts the 512MB limit
        // when running alongside yt-dlp + ffmpeg. Set RENDER_SKIP_BROWSER=true in render.yaml.
        const browserResults = [];
        if (process.env.RENDER_SKIP_BROWSER === 'true') {
            if (browserSources.length > 0) {
                log.scraper.info(`Skipping ${browserSources.length} browser source(s) — RENDER_SKIP_BROWSER=true`);
            }
        } else {
            for (const source of browserSources) {
                const result = await crawlBrowserSource(source, source.keywords);
                browserResults.push(result);
            }
        }

        // Process Google News (parallel, concurrency 5)
        await updatePipelineStage('scraping', 'Scraping Google News & Reddit...', { phase: 'gnews_reddit' });
        const gnewsResults = await processBatch(gnewsSources, crawlGoogleNewsWrapper, RSS_CONCURRENCY);

        // Process Reddit (parallel, concurrency 3)
        const redditResults = await processBatch(redditSources, crawlRedditWrapper, HTML_CONCURRENCY);

        // Summary
        const allResults = [...rssResults, ...htmlResults, ...pdfResults, ...youtubeResults, ...browserResults, ...gnewsResults, ...redditResults];
        const totalFound = allResults.reduce((sum, r) => sum + r.articlesFound, 0) + (ytSearchResults.totalFound || 0);
        const totalSaved = allResults.reduce((sum, r) => sum + r.articlesSaved, 0) + (ytSearchResults.totalSaved || 0);
        const totalErrors = allResults.reduce((sum, r) => sum + r.errors.length, 0) + (ytSearchResults.errors?.length || 0);
        const duration = Date.now() - startTime;

        log.scraper.info('=== Scraper cycle completed ===', {
            durationMs: duration,
            found: totalFound,
            saved: totalSaved,
            errors: totalErrors,
        });

        // Run temporal analysis per client in background (non-blocking)
        // Run temporal analysis per client in background (non-blocking)
        if (totalSaved > 0) {
            const clientIds = [...new Set(sources.map(s => s.client_id).filter(Boolean))];
            for (const clientId of clientIds) {
                runTemporalAnalysis(clientId).catch(e =>
                    log.ai.error('Post-scrape temporal analysis failed', { clientId, error: e.message })
                );
            }

            // Run batch intelligence directly (awaited) — setTimeout was unreliable on Render
            await updatePipelineStage('analysis', `Scraping done (${totalSaved} articles). Waiting for AI analysis...`, { found: totalFound, saved: totalSaved });
            log.ai.info('Scraping done (' + totalSaved + ' articles). Starting batch intelligence in 10s...');
            await new Promise(r => setTimeout(r, 10000)); // short breathing room for DB writes
            try {
                const { runBatchIntelligence } = await import('../ai/batch-intelligence.js');
                await runBatchIntelligence();
            } catch (e) {
                log.ai.error('Post-scrape batch intelligence failed', { error: e.message });
            }
        } else {
             await updatePipelineStage('analysis', `Scraping done (0 articles matched filters). Skipping AI analysis...`, { found: totalFound, saved: 0 });
        }
        
        // Always cleanly terminate the pipeline for the dashboard UI
        await updatePipelineStage('complete', 'Pipeline fully completed.');
        await new Promise(r => setTimeout(r, 2000)); // hold complete state for 2s so UI caches it
        
        // Import resetPipeline to clear the DB state for next run
        const { resetPipeline } = await import('../lib/pipeline-tracker.js');
        await resetPipeline();
    } finally {
        await releaseLock();
    }
}

/**
 * Scrape a single source by ID (for manual API trigger).
 * Uses fallback chain for RSS sources.
 * @param {string} sourceId - Source UUID
 */
export async function scrapeSourceById(sourceId) {
    const { data: source, error } = await supabase
        .from('sources')
        .select('id, client_id, name, url, source_type, last_scraped_at')
        .eq('id', sourceId)
        .single();

    if (error || !source) throw new Error(`Source not found: ${sourceId}`);

    const kws = await getClientKeywords(source.client_id);

    // Use fallback for RSS sources, direct call for others
    if (source.source_type === 'rss') {
        return crawlWithFallback({ ...source, keywords: kws }, kws);
    }

    const crawlFn = getCrawlFunction(source.source_type);
    if (!crawlFn) throw new Error(`Unknown source_type: ${source.source_type}`);
    return crawlFn(source, kws);
}
