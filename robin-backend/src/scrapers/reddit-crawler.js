// ============================================================
// ROBIN OSINT — Reddit Crawler
// Fetches posts from public subreddits using Reddit's JSON API.
// No authentication required for public subreddits.
// Used for source_type: 'reddit'
// ============================================================

import { log } from '../lib/logger.js';

const REDDIT_USER_AGENT = 'ROBIN-OSINT/1.0 (Intelligence Monitoring)';
const TIMEOUT_MS = 10000;

/**
 * Scrape posts from a Reddit subreddit.
 *
 * @param {Object} source - Source record from DB
 * @param {string} source.url - Reddit subreddit URL (e.g., https://www.reddit.com/r/india/)
 * @param {string} source.id - Source UUID
 * @param {string} source.name - Source display name
 * @param {string} clientId - Client UUID
 * @param {string[]} keywords - Keywords to match against
 * @returns {Promise<Object[]>} Array of raw content objects ready for content-saver
 */
async function scrapeRedditInternal(source, clientId, keywords = []) {
    const startTime = Date.now();
    const results = [];

    try {
        // Extract subreddit name from URL
        const subreddit = extractSubreddit(source.url);
        if (!subreddit) {
            log.scraper.warn('[Reddit] Invalid subreddit URL', { url: source.url });
            return [];
        }

        // Reddit JSON API (no auth needed for public subreddits)
        const jsonUrl = `https://www.reddit.com/r/${subreddit}/hot.json?limit=25`;

        const resp = await fetch(jsonUrl, {
            headers: { 'User-Agent': REDDIT_USER_AGENT },
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        if (!resp.ok) {
            log.scraper.warn('[Reddit] API error', { status: resp.status, subreddit });
            return [];
        }

        const data = await resp.json();
        const posts = data?.data?.children || [];

        for (const child of posts) {
            const post = child.data;
            if (!post || post.stickied) continue; // skip pinned posts

            const title = post.title || '';
            const content = post.selftext || post.title || '';
            const url = `https://www.reddit.com${post.permalink}`;
            const pubDate = post.created_utc ? new Date(post.created_utc * 1000) : new Date();

            if (!title || title.length < 5) continue;

            // Match keywords
            const fullText = `${title} ${content}`.toLowerCase();
            const matchedKws = keywords.filter(kw => fullText.includes(kw.toLowerCase()));

            if (matchedKws.length === 0) continue;

            results.push({
                contentType: 'reddit',
                title: title.substring(0, 500),
                content: content.substring(0, 5000) || title,
                url,
                publishedAt: pubDate,
                sourceId: source.id,
                clientId,
                matchedKeywords: matchedKws,
                language: 'en',
                sourceTier: 3, // Reddit = tier 3 by default
                typeMetadata: {
                    subreddit,
                    upvotes: post.ups || 0,
                    comment_count: post.num_comments || 0,
                    flair: post.link_flair_text || null,
                    is_self: post.is_self || false,
                    author: post.author || '[deleted]',
                    score: post.score || 0,
                },
            });
        }

        log.scraper.info('[Reddit] Subreddit scraped', {
            subreddit,
            posts: results.length,
            ms: Date.now() - startTime,
        });

    } catch (err) {
        log.scraper.error('[Reddit] Scrape failed', {
            source: source.name,
            url: source.url,
            error: err.message,
        });
    }

    return results;
}

/**
 * Extract subreddit name from a Reddit URL.
 * Handles: /r/india, /r/india/, reddit.com/r/india, etc.
 */
function extractSubreddit(url) {
    const match = url.match(/\/r\/([a-zA-Z0-9_]+)/);
    return match ? match[1] : null;
}

export async function scrapeReddit(source, clientId, keywords = []) {
    try {
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Reddit source timeout after 20s')), 20000)
        );
        return await Promise.race([
            scrapeRedditInternal(source, clientId, keywords),
            timeoutPromise,
        ]);
    } catch (err) {
        log.scraper.warn('Reddit source timed out or crashed', {
            source: source.name || source.url,
            error: err.message,
        });
        return [];
    }
}
