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
const MAX_HTML_PER_CYCLE = 30;

// Fallback chain: when primary crawler fails, try the next type
const FALLBACK_CHAIN = {
    rss: ['html', 'browser'],
    html: ['browser'],
    // browser, pdf, youtube have no fallbacks
};

/**
 * Acquire the scraper lock. Overrides if stuck for > 2 hours.
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
            log.scraper.warn('Overriding stale scraper lock', { hours: Math.round(hoursSince) });
        }

        await supabase.from('system_state').upsert({
            key: SCRAPER_LOCK_KEY,
            value: 'true',
            updated_at: new Date().toISOString(),
        });

        return true;
    } catch (error) {
        log.scraper.error('Failed to acquire lock', { error: error.message });
        return false;
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
 * @returns {Promise<Array>} Sources with keywords
 */
async function fetchAllActiveSources() {
    const { data: sources, error } = await supabase
        .from('sources')
        .select('id, client_id, name, url, source_type, last_scraped_at')
        .eq('is_active', true)
        .limit(500);

    if (error) throw new Error(`Failed to fetch sources: ${error.message}`);
    if (!sources || sources.length === 0) return [];

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
    return result;
}

/**
 * Run a complete scraper cycle across all clients and sources.
 */
export async function runScraperCycle() {
    const startTime = Date.now();
    log.scraper.info('=== Scraper cycle started ===');

    // Hint to GC before starting heavy scrape cycle
    if (global.gc) {
        global.gc();
        log.scraper.info('GC triggered before scrape cycle');
    }

    const locked = await acquireLock();
    if (!locked) return;

    try {
        const sources = await fetchAllActiveSources();
        if (sources.length === 0) {
            log.scraper.info('No active sources found');
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
        const htmlResults = await processBatch(htmlSourcesSorted, crawlHtmlSource, HTML_CONCURRENCY);

        // Process PDF (parallel, concurrency 2)
        const pdfResults = await processBatch(pdfSources, crawlPdfSource, PDF_CONCURRENCY);

        // Process YouTube (parallel, concurrency 3)
        await updatePipelineStage('scraping', 'Scraping YouTube & browser sources...', { phase: 'youtube' });
        const youtubeResults = await processBatch(youtubeSources, crawlYoutubeSource, YOUTUBE_CONCURRENCY);

        // Process Browser (SEQUENTIAL — memory intensive)
        const browserResults = [];
        for (const source of browserSources) {
            const result = await crawlBrowserSource(source, source.keywords);
            browserResults.push(result);
        }

        // Process Google News (parallel, concurrency 5)
        await updatePipelineStage('scraping', 'Scraping Google News & Reddit...', { phase: 'gnews_reddit' });
        const gnewsResults = await processBatch(gnewsSources, crawlGoogleNewsWrapper, RSS_CONCURRENCY);

        // Process Reddit (parallel, concurrency 3)
        const redditResults = await processBatch(redditSources, crawlRedditWrapper, HTML_CONCURRENCY);

        // Summary
        const allResults = [...rssResults, ...htmlResults, ...pdfResults, ...youtubeResults, ...browserResults, ...gnewsResults, ...redditResults];
        const totalFound = allResults.reduce((sum, r) => sum + r.articlesFound, 0);
        const totalSaved = allResults.reduce((sum, r) => sum + r.articlesSaved, 0);
        const totalErrors = allResults.reduce((sum, r) => sum + r.errors.length, 0);
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
