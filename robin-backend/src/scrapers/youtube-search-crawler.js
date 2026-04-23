// ============================================================
// ROBIN OSINT — YouTube Keyword Search Crawler
// Discovers NEW videos via YouTube Data API v3 Search
// Supplements existing channel-based crawler (does NOT replace it)
// ============================================================

import { getYoutubeApiKey } from '../lib/youtube.js';
import { matchArticle } from '../services/keyword-matcher.js';
import { saveContent } from '../services/content-saver.js';
import { supabase } from '../lib/supabase.js';
import { log } from '../lib/logger.js';

const MAX_QUERIES_PER_CLIENT = 8;   // keyword queries per client per cycle (default)
const MAX_RESULTS_PER_QUERY = 15;   // results per search query
const MAX_VIDEOS_TOTAL = 100;       // hard cap per cycle across all queries (default)
const RECENCY_DAYS = 7;             // only videos from last N days (default)

// ── Per-client overrides ──────────────────────────────────────
// RIGIOR (Naval War College India) posts to analytical/think-tank channels
// that publish infrequently — 30-day lookback and broader query coverage
// ensure no relevant content is missed between scrape cycles.
const RIGIOR_CLIENT_ID = 'c9493d5b-45bc-4c33-998b-e4d5cdde8f59';
const RIGIOR_OVERRIDES = {
    recencyDays:  30,   // catch analytical content up to 30 days old
    maxQueries:   20,   // cover 89-keyword set properly (vs default 8)
    maxTotal:    150,   // accommodate more queries
};

// Odisha — breaking regional news. Tight window keeps feed focused on current affairs.
const ODISHA_CLIENT_ID = '7b5390a0-0d5b-419e-84b4-533fd9c44d36';
const ODISHA_OVERRIDES = {
    recencyDays: 5,     // breaking news only
    maxQueries:  12,    // wider than default 8 since Odisha has many specific keywords
    maxTotal:   120,    // accommodate more queries
};

function getClientSearchOverrides(clientId) {
    if (clientId === RIGIOR_CLIENT_ID) return RIGIOR_OVERRIDES;
    if (clientId === ODISHA_CLIENT_ID) return ODISHA_OVERRIDES;
    return {};
}

function isIndicClient(clientId) {
    return clientId === RIGIOR_CLIENT_ID || clientId === ODISHA_CLIENT_ID;
}

// ── A1: in-memory keyword rotation cursor ──────────────────────
// The prior impl always picked the top-N scored keywords, so keywords
// ranked below the cap NEVER got searched. This cursor rotates the
// window across scrape cycles so every keyword eventually hits YouTube.
// Persists within a Render process; resets on Render restart which is fine —
// over a day the full keyword set still gets covered multiple times.
const keywordCursor = new Map(); // clientId -> next start index

/**
 * Run YouTube keyword-based search for all clients.
 * Called by the orchestrator AFTER channel-based YouTube crawling.
 *
 * @param {Map<string, Object>} clientKeywordMap - { clientId: { keywords, clientId } }
 * @returns {Promise<Object>} { totalFound, totalSaved, errors }
 */
export async function runYoutubeKeywordSearch(clientKeywordMap) {
    if (!getYoutubeApiKey()) {
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
            const result = await searchForClient(clientId, keywords);
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
 */
// ── A3: Auto-channel discovery ────────────────────────────────
// When keyword search repeatedly finds videos from the same channel (≥3 hits),
// it's a strong signal that channel is a persistent relevant source.
// Auto-promote it to the sources table so the channel crawler picks it up.
const AUTO_PROMOTE_MIN_HITS = 3;

async function autoPromoteChannels(clientId, channelHits) {
    const candidates = [...channelHits.entries()]
        .filter(([, v]) => v.count >= AUTO_PROMOTE_MIN_HITS);
    if (candidates.length === 0) return;

    for (const [channelId, { channelTitle }] of candidates) {
        const channelUrl = `https://www.youtube.com/channel/${channelId}`;
        try {
            const { data: existing } = await supabase
                .from('sources')
                .select('id')
                .eq('client_id', clientId)
                .eq('url', channelUrl)
                .maybeSingle();

            if (existing) continue;

            const { error } = await supabase.from('sources').insert({
                url:         channelUrl,
                name:        channelTitle || `YouTube Channel ${channelId}`,
                source_type: 'youtube',
                client_id:   clientId,
                is_active:   true,
            });

            if (!error) {
                log.scraper.info('A3: Auto-promoted YouTube channel to sources', {
                    clientId, channelId, channelTitle, channelUrl,
                });
            } else {
                log.scraper.warn('A3: Auto-promote insert failed', { channelId, error: error.message });
            }
        } catch (err) {
            log.scraper.warn('A3: Auto-promote error', { channelId, error: err.message });
        }
    }
}

async function searchForClient(clientId, keywords) {
    let found = 0;
    let saved = 0;
    const errors = [];
    const seenVideoIds = new Set();
    const channelHits = new Map(); // A3: channelId → { channelTitle, count }

    // Apply per-client overrides where configured
    const overrides    = getClientSearchOverrides(clientId);
    const recencyDays  = overrides.recencyDays ?? RECENCY_DAYS;
    const maxQueries   = overrides.maxQueries  ?? MAX_QUERIES_PER_CLIENT;
    const maxTotal     = overrides.maxTotal    ?? MAX_VIDEOS_TOTAL;

    // Resolve client name once (used for per-client AI persona in video summaries)
    let clientName = null;
    try {
        const { data: clientRow } = await supabase
            .from('clients')
            .select('name')
            .eq('id', clientId)
            .single();
        clientName = clientRow?.name || null;
    } catch { /* fall back to generic persona */ }

    // Pick the most specific keywords for search queries, with rotation so
    // all keywords eventually get coverage instead of just the top-scored N.
    const searchQueries = selectSearchQueries(keywords, maxQueries, clientId);

    log.scraper.info('YouTube keyword search starting', {
        clientId,
        queries: searchQueries.length,
        recencyDays,
        sampleQueries: searchQueries.slice(0, 3),
    });

    const publishedAfter = new Date(Date.now() - recencyDays * 86400000).toISOString();

    for (const query of searchQueries) {
        if (found >= maxTotal) break;

        try {
            // A2: for Indic clients, also pass relevanceLanguage=hi so YouTube's
            // own cross-script ranking surfaces Devanagari/regional-script titles
            // for English keywords (e.g. "Naveen Patnaik" → Hindi channel uploads).
            // Two API calls, merged by videoId dedupe — doubles quota per Indic query
            // but stays within the per-cycle maxTotal cap.
            const primary = await searchYouTubeAPI(query, publishedAfter);
            const indic   = isIndicClient(clientId)
                ? await searchYouTubeAPI(query, publishedAfter, 'hi')
                : [];
            const videos = [...primary];
            const seen = new Set(primary.map(v => v.videoId));
            for (const v of indic) { if (!seen.has(v.videoId)) { seen.add(v.videoId); videos.push(v); } }

            for (const video of videos) {
                if (found >= maxTotal) break;
                if (seenVideoIds.has(video.videoId)) continue;
                seenVideoIds.add(video.videoId);

                // A3: track channel hit frequency for auto-promotion
                if (video.channelId) {
                    const ch = channelHits.get(video.channelId) || { channelTitle: video.channelTitle, count: 0 };
                    ch.count++;
                    channelHits.set(video.channelId, ch);
                }

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
                        processing_status: 'queued', // Picked up by DB queue poller
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

                    // Queue via DB poller (same as channel crawler) — NOT fire-and-forget
                    // Calling processVideo() directly for every keyword-search result
                    // launches 100+ simultaneous 25-min pipeline waits and overloads the system.
                    // enqueueVideo() sets processing_status='queued' (already done by saveContent
                    // via typeMetadata) and kicks the sequential DB queue poller instead.
                    try {
                        const { enqueueVideo } = await import('../services/video-processor/video-queue.js');
                        enqueueVideo(video.videoId, saveResult.contentId, keywords, video.title || '');
                    } catch {
                        // Queue module may not be ready — video still saved as 'queued' for Render to pick up
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

    // A3: after all queries, auto-promote high-hit channels to sources table
    await autoPromoteChannels(clientId, channelHits);

    return { found, saved, errors };
}

/**
 * Call YouTube Data API v3 search endpoint.
 *
 * @param {string} query - Search term
 * @param {string} publishedAfter - ISO date string
 * @returns {Promise<Array>} Videos
 */
async function searchYouTubeAPI(query, publishedAfter, relevanceLanguage = null) {
    const params = {
        part: 'snippet',
        type: 'video',
        maxResults: String(MAX_RESULTS_PER_QUERY),
        order: 'relevance',
        publishedAfter,
        q: query,
    };
    if (relevanceLanguage) params.relevanceLanguage = relevanceLanguage;

    const url = `https://youtube.googleapis.com/youtube/v3/search`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
        const { fetchWithYoutubeRotation } = await import('../lib/youtube.js');
        const data = await fetchWithYoutubeRotation(url, params, controller.signal);
        clearTimeout(timeout);

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
                channelId: snippet.channelId || '', // A3: needed for auto-promotion
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
function selectSearchQueries(keywords, maxCount = MAX_QUERIES_PER_CLIENT, clientId = null) {
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

    // Sort by score (descending) — priority ordering within each window
    scored.sort((a, b) => b.score - a.score);

    // A1: rotate the window across cycles so keywords below the top-N cap
    // eventually get searched. Cursor is per-client and lives in process memory.
    const n = scored.length;
    if (!clientId || n <= maxCount) {
        return scored.slice(0, maxCount).map(s => s.keyword);
    }
    const cursor = keywordCursor.get(clientId) || 0;
    const start  = cursor % n;
    const rotated = [...scored.slice(start), ...scored.slice(0, start)];
    keywordCursor.set(clientId, (start + maxCount) % n);
    return rotated.slice(0, maxCount).map(s => s.keyword);
}
