// ============================================================
// ROBIN OSINT — Google News RSS Crawler
// Fetches articles from Google News RSS feeds.
// Used for source_type: 'google_news'
// ============================================================

import Parser from 'rss-parser';
import { log } from '../lib/logger.js';

const parser = new Parser({
    headers: { 'User-Agent': 'ROBIN-OSINT/1.0' },
    timeout: 15000,
    maxRedirects: 3,
});

/**
 * Scrape Google News RSS feed for a given source.
 *
 * @param {Object} source - Source record from DB
 * @param {string} source.url - Google News RSS URL (e.g., https://news.google.com/rss/search?q=...)
 * @param {string} source.id - Source UUID
 * @param {string} source.name - Source display name
 * @param {string} clientId - Client UUID
 * @param {string[]} keywords - Keywords to match against
 * @returns {Promise<Object[]>} Array of raw article objects ready for content-saver
 */
async function scrapeGoogleNewsInternal(source, clientId, keywords = []) {
    const startTime = Date.now();
    const results = [];

    try {
        const feed = await parser.parseURL(source.url);

        if (!feed || !feed.items) {
            log.scraper.warn('[GNews] Empty feed', { source: source.name, url: source.url });
            return [];
        }

        for (const item of feed.items.slice(0, 30)) { // max 30 items per feed
            const title = item.title || '';
            const link = extractGoogleNewsUrl(item.link || item.guid || '');
            const pubDate = item.pubDate || item.isoDate;
            const content = item.contentSnippet || item.content || item.summary || '';

            if (!link || !title) continue;

            // Match keywords
            const matchedKws = keywords.filter(kw =>
                title.toLowerCase().includes(kw.toLowerCase()) ||
                content.toLowerCase().includes(kw.toLowerCase())
            );

            if (matchedKws.length === 0) continue;

            results.push({
                contentType: 'article',
                title: cleanGoogleNewsTitle(title),
                content: content || title, // Google News snippets can be short
                url: link,
                publishedAt: pubDate ? new Date(pubDate) : new Date(),
                sourceId: source.id,
                clientId,
                matchedKeywords: matchedKws,
                language: 'en',
                sourceTier: 2,
                typeMetadata: {
                    api_source: 'google_news_rss',
                    original_source: extractPublicationFromTitle(title),
                    feed_title: feed.title || source.name,
                },
            });
        }

        log.scraper.info('[GNews] Feed scraped', {
            source: source.name,
            items: results.length,
            ms: Date.now() - startTime,
        });

    } catch (err) {
        log.scraper.error('[GNews] Scrape failed', {
            source: source.name,
            url: source.url,
            error: err.message,
        });
    }

    return results;
}

/**
 * Extract the actual article URL from a Google News redirect URL.
 * Google News links look like: https://news.google.com/rss/articles/...
 * The actual URL is embedded in the link or in the guid.
 */
function extractGoogleNewsUrl(gnewsUrl) {
    // Google News sometimes wraps URLs — try to extract the original
    try {
        if (gnewsUrl.includes('news.google.com') && gnewsUrl.includes('articles/')) {
            // Can't easily unwrap Google's URL — return as-is
            return gnewsUrl;
        }
        return gnewsUrl;
    } catch {
        return gnewsUrl;
    }
}

/**
 * Clean Google News titles (which include " - PublisherName" suffix).
 */
function cleanGoogleNewsTitle(title) {
    // Google News titles have format: "Article Title - Publisher Name"
    const dashIndex = title.lastIndexOf(' - ');
    if (dashIndex > 20) { // only strip if title is long enough
        return title.substring(0, dashIndex).trim();
    }
    return title;
}

/**
 * Extract publication name from Google News title suffix.
 */
function extractPublicationFromTitle(title) {
    const dashIndex = title.lastIndexOf(' - ');
    if (dashIndex > 0) {
        return title.substring(dashIndex + 3).trim();
    }
    return 'Google News';
}

export async function scrapeGoogleNews(source, clientId, keywords = []) {
    try {
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Google News source timeout after 20s')), 20000)
        );
        return await Promise.race([
            scrapeGoogleNewsInternal(source, clientId, keywords),
            timeoutPromise,
        ]);
    } catch (err) {
        log.scraper.warn('GNews source timed out or crashed', {
            source: source.name || source.url,
            error: err.message,
        });
        return [];
    }
}
