// ============================================================
// ROBIN OSINT — YouTube Crawler (RSS + API)
// Scrapes YouTube channels via RSS feed (no API key needed) or
// YouTube Data API v3 (broader lookback window).
// Pre-filters videos by title/description keyword match, then
// fires the full pipeline (Whisper transcription → translation →
// clip generation → AI summary) automatically for each saved video.
// ============================================================

import { getYoutubeApiKey, fetchWithYoutubeRotation } from '../lib/youtube.js';
import { matchArticle } from '../services/keyword-matcher.js';
import { updateSourceScrapeStatus } from '../services/article-saver.js';
import { saveContent } from '../services/content-saver.js';
import { enqueueVideo } from '../services/video-processor/video-queue.js';
import { translateToEnglish } from '../services/video-processor/translation-service.js';
import { log } from '../lib/logger.js';

const MAX_VIDEOS_API = 25;        // Fetch pool to search through
const MAX_VIDEOS_RSS = 25;        // RSS hard limit (YouTube)
const MAX_VIDEOS_PER_SOURCE = 25; // Max new videos saved per source per scrape cycle
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Returns true if the video title indicates a live stream, news bulletin,
 * or headline roundup — these are too generic or still-streaming to be useful.
 */
function isLiveOrBulletin(title) {
    if (!title) return false;
    return (
        /🔴/.test(title) ||                                               // Red dot = live indicator
        /\bLIVE\s*(NOW|STREAM|STREAMING|TELECAST)\b/i.test(title) ||     // Explicit live stream
        /\bLIVE\s*[:|]\s*$/i.test(title) ||                              // Ends with "Live:"
        /^\s*LIVE\s*$/i.test(title) ||                                    // Title is just "LIVE"
        /\b\d{1,2}\s*(AM|PM)\s*(Bulletin|Headlines?|News\s*Bulletin)\b/i.test(title) || // "9AM Bulletin"
        /\bTop\s+Headlines?\b/i.test(title) ||                           // "Top Headlines"
        /\b(Morning|Evening|Night|Afternoon)\s+(Bulletin|Headlines?)\b/i.test(title) || // "Morning Headlines"
        /\b(Daily|Weekly)\s+(Bulletin|Headlines?|Roundup|Wrap)\b/i.test(title)  // "Daily Bulletin"
    );
}

// ── Channel ID resolver ──────────────────────────────────────
/**
 * Resolve any YouTube channel URL format to its channel ID (UCxxx...).
 * Handles: /channel/UCxxx, /@handle, /c/name, /user/name
 */
async function resolveChannelId(url) {
    // Already a direct channel ID URL
    const directMatch = url.match(/youtube\.com\/channel\/(UC[a-zA-Z0-9_-]+)/);
    if (directMatch) return directMatch[1];

    // Invalid: search results page — skip immediately
    if (url.includes('results?search_query') || url.includes('/results?')) {
        return null;
    }

    // Handle/@, /c/, /user/ → fetch channel page and extract ID
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        const res = await fetch(url, {
            headers: { 'User-Agent': USER_AGENT },
            signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!res.ok) return null;

        const html = await res.text();

        // RSS link in HTML <head> — most reliable
        const rssMatch = html.match(/feeds\/videos\.xml\?channel_id=(UC[a-zA-Z0-9_-]+)/);
        if (rssMatch) return rssMatch[1];

        // Fallback: channelId in page JSON
        for (const pattern of [
            /"channelId":"(UC[a-zA-Z0-9_-]+)"/,
            /"externalId":"(UC[a-zA-Z0-9_-]+)"/,
            /"browseId":"(UC[a-zA-Z0-9_-]+)"/,
        ]) {
            const m = html.match(pattern);
            if (m) return m[1];
        }
        return null;
    } catch {
        return null;
    }
}

// ── YouTube Data API v3 fetcher ──────────────────────────────
/**
 * Fetch the last MAX_VIDEOS_API videos from a channel using the official API.
 * This looks at the "Uploads" playlist (UU instead of UC).
 * Costs 1 quota unit.
 */
async function fetchChannelVideosAPI(channelId) {
    if (!getYoutubeApiKey()) return null;

    // Convert channel ID (UC...) to Uploads playlist ID (UU...)
    const uploadsPlaylistId = channelId.replace(/^UC/, 'UU');
    const apiUrl = `https://youtube.googleapis.com/youtube/v3/playlistItems`;
    const params = {
        part: 'snippet',
        playlistId: uploadsPlaylistId,
        maxResults: String(MAX_VIDEOS_API)
    };

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        const data = await fetchWithYoutubeRotation(apiUrl, params, controller.signal);
        clearTimeout(timeout);

        const videos = [];
        for (const item of data.items || []) {
            const snippet = item.snippet;
            const videoId = snippet?.resourceId?.videoId;
            if (!videoId) continue;

            videos.push({
                videoId,
                title: snippet.title || '',
                description: (snippet.description || '').substring(0, 1500),
                publishedAt: snippet.publishedAt ? new Date(snippet.publishedAt) : new Date(),
            });
        }

        return videos;
    } catch (error) {
        log.scraper.warn('YouTube API fetch errored (will fallback)', { channelId, error: error.message });
        return null;
    }
}

// ── YouTube RSS feed fetcher (Fallback) ──────────────────────
/**
 * Fetch the last MAX_VIDEOS_RSS videos from a channel's RSS feed.
 * Works on ALL YouTube channels — no API key, no yt-dlp, no blocking.
 */
async function fetchChannelRSS(channelId) {
    const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        const res = await fetch(feedUrl, {
            headers: { 'User-Agent': USER_AGENT },
            signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!res.ok) return [];

        const xml = await res.text();
        const videos = [];
        const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
        let match;

        while ((match = entryRegex.exec(xml)) !== null) {
            const entry = match[1];
            const videoId = entry.match(/<yt:videoId>(.*?)<\/yt:videoId>/)?.[1]?.trim() ?? '';
            const rawTitle = entry.match(/<title>(.*?)<\/title>/)?.[1] ?? '';
            const published = entry.match(/<published>(.*?)<\/published>/)?.[1] ?? '';
            const rawDesc = entry.match(/<media:description>([\s\S]*?)<\/media:description>/)?.[1] ?? '';

            if (!videoId) continue;

            // Decode basic HTML entities in title/description
            const decode = (s) => s
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&#39;/g, "'")
                .replace(/&quot;/g, '"')
                .trim();

            const decodedTitle = decode(rawTitle);
            
            // Skip actual livestreams/premieres — but NOT regular videos with "Live" in title
            // Many Odia news channels title uploaded clips "...Live Update" etc.
            const titleUpper = decodedTitle.toUpperCase();
            if (
                /🔴/.test(decodedTitle) ||
                /\bLIVE\s*(NOW|STREAM|STREAMING|TELECAST)\b/i.test(decodedTitle) ||
                /\bLIVE\s*[:|]\s*$/i.test(decodedTitle) ||
                titleUpper === 'LIVE'
            ) {
                log.scraper.debug?.('Skipping YouTube livestream/premiere', { channelId, title: decodedTitle });
                continue;
            }

            videos.push({
                videoId,
                title: decodedTitle,
                description: decode(rawDesc).substring(0, 1500),
                publishedAt: published ? new Date(published) : new Date(),
            });
        }

        return videos.slice(0, MAX_VIDEOS_RSS);
    } catch (error) {
        log.scraper.warn('YouTube RSS fetch failed', { channelId, error: error.message });
        return [];
    }
}

// ── Main crawler ─────────────────────────────────────────────
/**
 * Crawl a YouTube source using RSS feed as primary method.
 * - Resolves channel handle → channel ID
 * - Fetches RSS feed (works on ALL channels, no blocking)
 * - Keyword matches on title + description
 * - Optionally enriches with yt-dlp transcript (non-blocking, 20s timeout)
 * - Saves all matched videos with thumbnails
 */
async function crawlYoutubeSourceInternal(source, keywords) {
    const result = { sourceId: source.id, articlesFound: 0, articlesSaved: 0, errors: [] };

    try {
        // Skip invalid search result URLs immediately
        if (source.url.includes('results?search_query') || source.url.includes('/results?')) {
            log.scraper.warn('Skipping invalid YouTube search URL — not a channel', {
                source: source.name,
                url: source.url,
            });
            await updateSourceScrapeStatus(source.id, false, 'Invalid URL: YouTube search results page');
            return result;
        }

        // Step 1: Resolve channel URL → channel ID
        log.scraper.info('YouTube: resolving channel ID', { source: source.name, url: source.url });
        const channelId = await resolveChannelId(source.url);

        if (!channelId) {
            log.scraper.warn('YouTube: could not resolve channel ID', { source: source.name, url: source.url });
            await updateSourceScrapeStatus(source.id, false, 'Could not resolve YouTube channel ID');
            return result;
        }

        // Step 2: Fetch videos (Try API first, fallback to RSS)
        let videos = [];
        let sourceMethod = 'rss';

        // Attempt API if configured
        if (getYoutubeApiKey()) {
            const apiVideos = await fetchChannelVideosAPI(channelId);
            if (apiVideos) {
                videos = apiVideos;
                sourceMethod = 'api';
            }
        }

        // Fallback to RSS if API didn't run or failed
        if (videos.length === 0 && sourceMethod !== 'api') {
            videos = await fetchChannelRSS(channelId);
            sourceMethod = 'rss';
        }

        result.articlesFound = videos.length;

        if (videos.length === 0) {
            log.scraper.info('YouTube: no videos found', { source: source.name, channelId, method: sourceMethod });
            await updateSourceScrapeStatus(source.id, true);
            return result;
        }

        log.scraper.info(`YouTube: ${videos.length} videos found via ${sourceMethod}`, {
            source: source.name,
            channelId,
        });

        // Step 3: Match + save each video (cap at MAX_VIDEOS_PER_SOURCE per cycle)
        let savedThisCycle = 0;
        for (const video of videos) {
            if (savedThisCycle >= MAX_VIDEOS_PER_SOURCE) break;

            try {
                // Skip live streams, bulletins, and headline roundups —
                // these are either still streaming or too generic.
                if (isLiveOrBulletin(video.title)) {
                    log.scraper.debug?.('Skipping live/bulletin video', { title: video.title });
                    continue;
                }

                // Pre-filter: Keyword match on title + description
                // Translate title/desc rapidly so English keywords hit Odia titles!
                const titleAndDesc = `${video.title} - ${video.description.substring(0, 100)}`;
                let englishTitleDesc = titleAndDesc;
                try {
                    englishTitleDesc = await translateToEnglish(titleAndDesc, 'or');
                } catch (e) {
                    // fall back to original
                }
                
                const combinedSearchText = `${titleAndDesc} ${englishTitleDesc}`;
                const match = matchArticle({ title: video.title, content: combinedSearchText }, keywords);

                if (!match.matched) continue;

                const matchedKws = match.matchedKeywords;
                const thumbnailUrl = `https://img.youtube.com/vi/${video.videoId}/maxresdefault.jpg`;

                // Save with description as initial content.
                // The pipeline will replace this with the full English transcript after Whisper processing.
                const saveResult = await saveContent({
                    contentType: 'video',
                    title: `[VIDEO] ${video.title}`,
                    content: video.description || video.title,
                    url: `https://www.youtube.com/watch?v=${video.videoId}`,
                    publishedAt: video.publishedAt,
                    sourceId: source.id,
                    clientId: source.client_id,
                    matchedKeywords: match.matchedKeywords,
                    typeMetadata: {
                        channel_name: source.name || '',
                        image_url: thumbnailUrl,
                        processing_status: 'queued',
                        processing_message: 'Queued for transcription and clip generation',
                    },
                });

                if (saveResult.saved) {
                    result.articlesSaved++;
                    savedThisCycle++;
                    log.scraper.info('YouTube video saved — queued for pipeline', {
                        title: video.title.substring(0, 60),
                        videoId: video.videoId,
                    });

                    // Add to sequential queue — videos are processed one at a time
                    // to avoid exhausting Groq API rate limits.
                    // Pass ALL brief keywords to maximize clip generation across the full transcript!
                    enqueueVideo(video.videoId, saveResult.contentId, keywords, video.title);
                }
            } catch (error) {
                result.errors.push({ videoId: video.videoId, error: error.message });
                log.scraper.warn('YouTube video processing failed', {
                    videoId: video.videoId,
                    error: error.message,
                });
            }
        }

        await updateSourceScrapeStatus(source.id, true);
        log.scraper.info('YouTube crawl complete', {
            source: source.name || source.url,
            found: result.articlesFound,
            saved: result.articlesSaved,
        });

    } catch (error) {
        await updateSourceScrapeStatus(source.id, false, error.message);
        result.errors.push({ error: error.message });
        log.scraper.error('YouTube crawl failed', { source: source.url, error: error.message });
    }

    return result;
}

export async function crawlYoutubeSource(source, keywords) {
    const result = { sourceId: source.id, articlesFound: 0, articlesSaved: 0, errors: [] };
    try {
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('YouTube source timeout after 5m')), 300000)
        );
        return await Promise.race([
            crawlYoutubeSourceInternal(source, keywords),
            timeoutPromise,
        ]);
    } catch (err) {
        log.scraper.warn('YouTube source timed out or crashed', {
            source: source.name || source.url,
            error: err.message,
        });
        await updateSourceScrapeStatus(source.id, false, err.message);
        return { ...result, errors: [{ error: err.message }] };
    }
}
