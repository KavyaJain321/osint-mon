// ============================================================
// ROBIN OSINT — YouTube Crawler (RSS-based)
// Primary: YouTube Channel RSS Feed (works on ALL channels)
// Secondary: yt-dlp transcript enrichment (optional, non-blocking)
// ============================================================

import { spawn } from 'child_process';
import { readFile, unlink, mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { matchArticle } from '../services/keyword-matcher.js';
import { updateSourceScrapeStatus } from '../services/article-saver.js';
import { saveContent } from '../services/content-saver.js';
import { log } from '../lib/logger.js';

const MAX_VIDEOS_API = 50; // API lookback window (very wide for news channels)
const MAX_VIDEOS_RSS = 15; // RSS hard limit by YouTube
const TRANSCRIPT_TIMEOUT_MS = 20000; // 20s max to wait for yt-dlp transcript
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ── VTT parser ───────────────────────────────────────────────
function parseVttToText(vttContent) {
    const lines = vttContent.split('\n');
    const seen = new Set();
    const textLines = [];

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith('WEBVTT')) continue;
        if (trimmed.startsWith('Kind:') || trimmed.startsWith('Language:')) continue;
        if (/^\d{2}:\d{2}/.test(trimmed)) continue;
        if (/^NOTE/.test(trimmed)) continue;

        const clean = trimmed
            .replace(/<[^>]+>/g, '')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&nbsp;/g, ' ')
            .trim();

        if (!clean) continue;
        if (!seen.has(clean)) {
            seen.add(clean);
            textLines.push(clean);
        }
    }

    return textLines.join(' ').replace(/\s+/g, ' ').trim();
}

// ── yt-dlp transcript (optional enrichment) ─────────────────
/**
 * Try to fetch a transcript via yt-dlp. 
 * Returns null if unavailable — caller always continues without it.
 */
async function fetchTranscriptYtDlp(videoId) {
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    let tmpDir = null;

    try {
        tmpDir = await mkdtemp(join(tmpdir(), 'yt_sub_'));
        const outputTemplate = join(tmpDir, videoId);

        await new Promise((resolve, reject) => {
            const proc = spawn('yt-dlp', [
                '--write-auto-sub',
                '--sub-langs', 'en',
                '--skip-download',
                '--no-playlist',
                '--output', outputTemplate,
                '--quiet',
                '--no-warnings',
                videoUrl,
            ], { timeout: 30000 });

            let stderr = '';
            proc.stderr.on('data', (d) => { stderr += d.toString(); });
            proc.on('close', (code) => {
                if (code === 0) resolve();
                else reject(new Error(stderr.substring(0, 200) || `yt-dlp exited ${code}`));
            });
            proc.on('error', reject);
        });

        const vttPath = `${outputTemplate}.en.vtt`;
        let vttContent;
        try {
            vttContent = await readFile(vttPath, 'utf-8');
        } catch {
            return null;
        }

        const text = parseVttToText(vttContent);
        await unlink(vttPath).catch(() => { });
        return text.length >= 100 ? text.substring(0, 15000) : null;

    } catch (error) {
        log.scraper.debug?.('yt-dlp transcript unavailable', { videoId, error: error.message });
        return null;
    } finally {
        if (tmpDir) {
            try {
                const { rm } = await import('fs/promises');
                await rm(tmpDir, { recursive: true, force: true });
            } catch { /* ignore */ }
        }
    }
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
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) return null;

    // Convert channel ID (UC...) to Uploads playlist ID (UU...)
    const uploadsPlaylistId = channelId.replace(/^UC/, 'UU');
    const apiUrl = `https://youtube.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=${MAX_VIDEOS_API}&key=${apiKey}`;

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        const res = await fetch(apiUrl, { signal: controller.signal });
        clearTimeout(timeout);

        if (!res.ok) {
            const errorText = await res.text();
            log.scraper.warn('YouTube API fetch failed (will fallback)', { channelId, status: res.status, error: errorText });
            return null; // Signals fallback to RSS
        }

        const data = await res.json();
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
        if (process.env.YOUTUBE_API_KEY) {
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

        // Step 3: Match + save each video
        for (const video of videos) {
            try {
                // Keyword match on TITLE + DESCRIPTION
                const match = matchArticle({ title: video.title, content: video.description }, keywords);
                
                if (!match.matched) continue;
                
                const matchedKws = match.matchedKeywords;

                // Step 4 (optional): Try to enrich with full transcript via yt-dlp
                // Non-blocking: we save the video regardless of whether transcript succeeds
                let transcript = null;
                try {
                    transcript = await Promise.race([
                        fetchTranscriptYtDlp(video.videoId),
                        new Promise((resolve) => setTimeout(() => resolve(null), TRANSCRIPT_TIMEOUT_MS)),
                    ]);
                } catch {
                    // Transcript unavailable — fine, save without it
                }

                const thumbnailUrl = `https://img.youtube.com/vi/${video.videoId}/maxresdefault.jpg`;
                // Use transcript if available (richer content), else use description
                const content = transcript || video.description || video.title;

                const saveResult = await saveContent({
                    contentType: 'video',
                    title: `[VIDEO] ${video.title}`,
                    content,
                    url: `https://www.youtube.com/watch?v=${video.videoId}`,
                    publishedAt: video.publishedAt,
                    sourceId: source.id,
                    clientId: source.client_id,
                    matchedKeywords: match.matchedKeywords,
                    typeMetadata: {
                        channel_name: source.name || '',
                        has_captions: !!transcript,
                        image_url: thumbnailUrl,
                    },
                });

                if (saveResult.saved) {
                    result.articlesSaved++;
                    log.scraper.info('YouTube video saved via RSS', {
                        title: video.title.substring(0, 60),
                        videoId: video.videoId,
                        hasTranscript: !!transcript,
                    });
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
