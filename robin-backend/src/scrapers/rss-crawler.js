// ============================================================
// ROBIN OSINT — RSS Crawler
// Fast, reliable — handles ~60% of news sources
// ============================================================

import RSSParser from 'rss-parser';
import { JSDOM, VirtualConsole } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { matchArticle, cleanArticleContent } from '../services/keyword-matcher.js';
import { saveArticle, updateSourceScrapeStatus } from '../services/article-saver.js';
import { log } from '../lib/logger.js';

// Silent virtualConsole — suppresses noisy jsdom CSS parse errors from Render logs
const silentConsole = new VirtualConsole();
silentConsole.sendTo(console, { omitJSDOMErrors: true });

const parser = new RSSParser({
    timeout: 10000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        'Accept-Language': 'en-US,en;q=0.9',
    },
});

const MAX_ARTICLES_PER_RUN = 20;
const CONCURRENT_BATCH_SIZE = 1;

/**
 * Fetch and parse an RSS feed.
 * @param {string} url - RSS feed URL
 * @returns {Promise<Array>} Feed items (empty on error)
 */
export async function fetchRssFeed(url) {
    try {
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('RSS fetch timeout')), 12000)
        );
        const feed = await Promise.race([
            parser.parseURL(url),
            timeoutPromise
        ]);
        return feed.items || [];
    } catch (error) {
        log.scraper.warn('RSS feed fetch failed', { url, error: error.message });
        return [];
    }
}

/**
 * Fetch full article content from a URL using Readability.
 * @param {string} url - Article URL
 * @returns {Promise<{ title: string, content: string, publishedAt: Date }|null>}
 */
export async function fetchFullArticleContent(url) {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(url, {
            signal: controller.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        });
        clearTimeout(timeout);

        const html = await response.text();
        // Strip style/script/svg before jsdom — dramatically reduces DOM memory usage
        const stripped = html
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<svg[\s\S]*?<\/svg>/gi, '')
            .replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
        const dom = new JSDOM(stripped, { url, virtualConsole: silentConsole });

        // Extract og:image from original html (regex, avoids DOM overhead)
        const ogImageMatch = html.match(/property=["']og:image["'][^>]*content=["']([^"']+)["']/)
            || html.match(/content=["']([^"']+)["'][^>]*property=["']og:image["']/);
        const twitterImageMatch = html.match(/name=["']twitter:image["'][^>]*content=["']([^"']+)["']/)
            || html.match(/content=["']([^"']+)["'][^>]*name=["']twitter:image["']/);
        const ogImage = ogImageMatch?.[1] || twitterImageMatch?.[1] || null;

        const reader = new Readability(dom.window.document);
        const article = reader.parse();

        if (!article || !article.textContent) {
            const body = dom.window.document.querySelector('article, main, .article-body, body');
            const fallbackContent = body?.textContent?.replace(/\s+/g, ' ').trim() || '';
            return {
                title: dom.window.document.title || '',
                content: fallbackContent.substring(0, 5000),
                imageUrl: ogImage,
                publishedAt: new Date(),
            };
        }

        return {
            title: article.title || '',
            content: article.textContent.replace(/\s+/g, ' ').trim().substring(0, 5000),
            imageUrl: ogImage,
            publishedAt: new Date(),
        };
    } catch (error) {
        log.scraper.warn('Full article fetch failed', { url, error: error.message });
        return null;
    }
}

/**
 * Crawl an RSS source: fetch feed, filter by keywords, save matches.
 * @param {Object} source - Source record { id, url, client_id, last_scraped_at }
 * @param {string[]} keywords - Watch keywords for this client
 * @returns {Promise<{ sourceId, articlesFound, articlesSaved, errors }>}
 */
export async function crawlRssSource(source, keywords) {
    const result = { sourceId: source.id, articlesFound: 0, articlesSaved: 0, errors: [] };

    try {
        const items = await fetchRssFeed(source.url);
        if (items.length === 0) {
            await updateSourceScrapeStatus(source.id, false, 'Empty RSS feed');
            return result;
        }

        // Filter: only items after last_scraped_at (or last 48hrs)
        const since = source.last_scraped_at
            ? new Date(source.last_scraped_at)
            : new Date(Date.now() - 48 * 60 * 60 * 1000);

        const recentItems = items
            .filter((item) => {
                const pubDate = new Date(item.pubDate || item.isoDate || Date.now());
                return pubDate > since;
            })
            .slice(0, MAX_ARTICLES_PER_RUN);

        result.articlesFound = recentItems.length;

        // Non-English sources bypass keyword matching — the AI reads the language natively.
        // English string matching on Hindi/Urdu/etc. text always returns 0 matches,
        // so we skip the gate and let TRIJYA-7/Groq decide relevance instead.
        const isNonEnglish = source.language && source.language !== 'en';

        // Process in batches of CONCURRENT_BATCH_SIZE
        for (let i = 0; i < recentItems.length; i += CONCURRENT_BATCH_SIZE) {
            const batch = recentItems.slice(i, i + CONCURRENT_BATCH_SIZE);
            const promises = batch.map(async (item) => {
                try {
                    if (!isNonEnglish) {
                        // English sources: quick keyword gate before fetching full content
                        const quickText = cleanArticleContent(`${item.title || ''} ${item.contentSnippet || item.content || ''}`);
                        const quickMatch = matchArticle({ title: item.title || '', content: quickText }, keywords);
                        if (!quickMatch.matched) return;
                    }

                    // Fetch full article content
                    const fullArticle = await fetchFullArticleContent(item.link);
                    if (!fullArticle) return;

                    // Re-match on cleaned content for keyword tagging
                    // Non-English: still tag any English keywords that happen to appear
                    // (e.g. "Nari Shakti Vandan Adhiniyam" in a Hindi article's URL or byline)
                    const cleanedContent = cleanArticleContent(fullArticle.content);
                    const fullMatch = matchArticle(
                        { title: fullArticle.title || item.title, content: cleanedContent },
                        keywords
                    );

                    // Non-English sources: always save (AI decides relevance)
                    // English sources: require at least one keyword match
                    if (!isNonEnglish && !fullMatch.matched) return;
                    const matchedKws = fullMatch.matchedKeywords;

                    // Collect image: try RSS enclosure, media:thumbnail, then og:image from fetched HTML
                    const rssImage = item.enclosure?.url
                        || item['media:thumbnail']?.['$']?.url
                        || item['media:content']?.['$']?.url
                        || null;
                    const imageUrl = rssImage || fullArticle.imageUrl || null;

                    const saveResult = await saveArticle({
                        title: fullArticle.title || item.title || 'Untitled',
                        content: fullArticle.content,
                        url: item.link,
                        publishedAt: item.pubDate || item.isoDate || new Date(),
                        sourceId: source.id,
                        clientId: source.client_id,
                        matchedKeywords: matchedKws,
                        imageUrl,
                    });

                    if (saveResult.saved) {
                        result.articlesSaved++;
                    }
                } catch (error) {
                    result.errors.push({ url: item.link, error: error.message });
                }
            });

            await Promise.allSettled(promises);
        }

        await updateSourceScrapeStatus(source.id, true);
        log.scraper.info('RSS crawl complete', {
            source: source.name || source.url,
            found: result.articlesFound,
            saved: result.articlesSaved,
        });
    } catch (error) {
        await updateSourceScrapeStatus(source.id, false, error.message);
        result.errors.push({ error: error.message });
        log.scraper.error('RSS crawl failed', { source: source.url, error: error.message });
    }

    return result;
}
