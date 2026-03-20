// ============================================================
// ROBIN OSINT — YouTube Keyword Search Crawler
// Discovers NEW videos via YouTube Data API v3 Search
// Supplements existing channel-based crawler (does NOT replace it)
// ============================================================

import { matchArticle } from '../services/keyword-matcher.js';
import { saveContent } from '../services/content-saver.js';
import { log } from '../lib/logger.js';

const MAX_QUERIES_PER_CLIENT = 8;   // keyword queries per client per cycle
const MAX_RESULTS_PER_QUERY = 15;   // results per search query
const MAX_VIDEOS_TOTAL = 100;       // hard cap: 50-100 per cycle across all queries
const RECENCY_DAYS = 7;             // only videos from last 7 days

/**
 * Run YouTube keyword-based search for all clients.
 * Called by the orchestrator AFTER channel-based YouTube crawling.
 *
 * @param {Map<string, Object>} clientKeywordMap - { clientId: { keywords, clientId } }
 * @returns {Promise<Object>} { totalFound, totalSaved, errors }
 */
export async function runYoutubeKeywordSearch(clientKeywordMap) {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
        log.scraper.info('YouTube keyword search skipped — no YOUTUBE_API_KEY');
        return { totalFound: 0, totalSaved: 0, errors: [] };
    }

    let totalFound = 0;
    let totalSaved = 0;
    const errors = [];

    for (const [clientId, clientData] of Object.entries(clientKeywordMap)) {
        const { keywords } = clientData;
        if (!keywords || keywords.length === 0) continue;

        try {
            const result = await searchForClient(clientId, keywords, apiKey);
            totalFound += result.found;
            totalSaved += result.saved;
            if (result.errors.length > 0) errors.push(...result.errors);
        } catch (error) {
            log.scraper.error('YouTube keyword search failed for client', {
                clientId,
                error: error.message,
            });
            errors.push({ clientId, error: error.message });
        }
    }

    if (totalFound > 0) {
        log.scraper.info('YouTube keyword search complete', { totalFound, totalSaved, errors: errors.length });
    }

    return { totalFound, totalSaved, errors };
}

/**
 * Search YouTube for videos matching a client's keywords.
 *
 * @param {string} clientId
 * @param {string[]} keywords
 * @param {string} apiKey
 */
async function searchForClient(clientId, keywords, apiKey) {
    let found = 0;
    let saved = 0;
    const errors = [];
    const seenVideoIds = new Set();

    // Pick the most specific keywords for search queries
    const searchQueries = selectSearchQueries(keywords);

    log.scraper.info('YouTube keyword search starting', {
        clientId,
        queries: searchQueries.length,
        sampleQueries: searchQueries.slice(0, 3),
    });

    const publishedAfter = new Date(Date.now() - RECENCY_DAYS * 86400000).toISOString();

    for (const query of searchQueries) {
        if (found >= MAX_VIDEOS_TOTAL) break;

        try {
            const videos = await searchYouTubeAPI(query, apiKey, publishedAfter);

            for (const video of videos) {
                if (found >= MAX_VIDEOS_TOTAL) break;
                if (seenVideoIds.has(video.videoId)) continue;
                seenVideoIds.add(video.videoId);

                // Keyword match on title + description (reuse existing matching logic)
                const match = matchArticle(
                    { title: video.title, content: video.description },
                    keywords
                );

                // For search results, we're more lenient — the search query itself
                // provides relevance, so save even if matchArticle doesn't match
                // (YouTube's own relevance scoring already filtered)
                const matchedKws = match.matched
                    ? match.matchedKeywords
                    : [query]; // Use the search query as the matched keyword

                const thumbnailUrl = `https://img.youtube.com/vi/${video.videoId}/maxresdefault.jpg`;

                const saveResult = await saveContent({
                    contentType: 'video',
                    title: `[VIDEO] ${video.title}`,
                    content: video.description || video.title,
                    url: `https://www.youtube.com/watch?v=${video.videoId}`,
                    publishedAt: video.publishedAt,
                    sourceId: null, // No source — discovered via keyword search
                    clientId,
                    matchedKeywords: matchedKws,
                    typeMetadata: {
                        channel_name: video.channelTitle || '',
                        has_captions: false, // Will be enriched by pipeline
                        image_url: thumbnailUrl,
                        discovery_method: 'keyword_search',
                        search_query: query,
                    },
                });

                found++;
                if (saveResult.saved) {
                    saved++;
                    log.scraper.info('YouTube search video saved', {
                        title: video.title.substring(0, 60),
                        query,
                        videoId: video.videoId,
                    });

                    // Fire-and-forget video processing pipeline
                    try {
                        const { processVideo } = await import('../services/video-processor/pipeline.js');
                        processVideo(video.videoId, saveResult.contentId, matchedKws)
                            .catch(err => log.scraper.warn('Video pipeline failed (search)', {
                                videoId: video.videoId,
                                error: err.message?.substring(0, 100),
                            }));
                    } catch {
                        // Pipeline module may not be ready — video still saved
                    }
                }
            }

            // Small delay between API calls
            await new Promise(r => setTimeout(r, 300));

        } catch (error) {
            log.scraper.warn('YouTube search query failed', { query, error: error.message });
            errors.push({ query, error: error.message });
        }
    }

    return { found, saved, errors };
}

/**
 * Call YouTube Data API v3 search endpoint.
 *
 * @param {string} query - Search term
 * @param {string} apiKey
 * @param {string} publishedAfter - ISO date string
 * @returns {Promise<Array>} Videos
 */
async function searchYouTubeAPI(query, apiKey, publishedAfter) {
    const params = new URLSearchParams({
        part: 'snippet',
        type: 'video',
        maxResults: String(MAX_RESULTS_PER_QUERY),
        order: 'relevance',
        publishedAfter,
        q: query,
        key: apiKey,
    });

    const url = `https://youtube.googleapis.com/youtube/v3/search?${params}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);

        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`YouTube search API ${res.status}: ${errorText.substring(0, 100)}`);
        }

        const data = await res.json();
        const videos = [];

        for (const item of data.items || []) {
            const snippet = item.snippet;
            const videoId = item.id?.videoId;
            if (!videoId) continue;

            // Skip livestreams
            if (snippet.liveBroadcastContent === 'live' || snippet.liveBroadcastContent === 'upcoming') {
                continue;
            }

            videos.push({
                videoId,
                title: snippet.title || '',
                description: (snippet.description || '').substring(0, 1500),
                publishedAt: snippet.publishedAt ? new Date(snippet.publishedAt) : new Date(),
                channelTitle: snippet.channelTitle || '',
            });
        }

        return videos;
    } catch (error) {
        clearTimeout(timeout);
        throw error;
    }
}

/**
 * Select the best keywords to use as YouTube search queries.
 * Prioritizes multi-word, specific keywords over single generic ones.
 *
 * @param {string[]} keywords
 * @returns {string[]} Top search queries
 */
function selectSearchQueries(keywords) {
    if (!keywords || keywords.length === 0) return [];

    // Score keywords by specificity
    const scored = keywords.map(kw => {
        const words = kw.split(/\s+/).length;
        let score = 0;

        // Multi-word keywords are better search queries
        if (words >= 3) score += 3;
        else if (words === 2) score += 2;
        else score += 1;

        // Longer keywords tend to be more specific
        if (kw.length > 15) score += 1;

        // Proper nouns (capitalized) are good entities
        if (/[A-Z]/.test(kw.charAt(0))) score += 1;

        return { keyword: kw, score };
    });

    // Sort by score (descending) and take top N
    scored.sort((a, b) => b.score - a.score);

    return scored
        .slice(0, MAX_QUERIES_PER_CLIENT)
        .map(s => s.keyword);
}
