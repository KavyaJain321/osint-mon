// ============================================================
// ROBIN OSINT — HTML Crawler (Cheerio)
// For static sites without RSS — no browser needed
// ============================================================

import * as cheerio from 'cheerio';
import { JSDOM, VirtualConsole } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { matchArticle, topicRelevant } from '../services/keyword-matcher.js';
import { saveArticle, updateSourceScrapeStatus } from '../services/article-saver.js';
import { log } from '../lib/logger.js';

const MAX_LINKS = 30;
const MAX_ARTICLES = 20;
const CONCURRENT_BATCH_SIZE = 1; // Sequential per source — prevents OOM with jsdom
const USER_AGENT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

/**
 * Fetch a page's HTML content.
 * @param {string} url - Page URL
 * @returns {Promise<string|null>}
 */
export async function fetchPage(url, timeoutMs = 8000) {
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), timeoutMs);

    const fetchPromise = fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT },
    }).then(r => r.text());

    const killPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`fetchPage hard timeout ${timeoutMs}ms`)), timeoutMs + 2000)
    );

    try {
        const text = await Promise.race([fetchPromise, killPromise]);
        clearTimeout(abortTimer);
        return text;
    } catch (error) {
        clearTimeout(abortTimer);
        log.scraper.warn('Page fetch failed', {
            url: url.substring(0, 80),
            error: error.message,
        });
        return null;
    }
}

/**
 * Extract article links from HTML using Cheerio.
 * @param {string} html - Page HTML
 * @param {string} baseUrl - Base URL for resolving relative links
 * @returns {string[]} Array of absolute article URLs
 */
export function extractArticleLinks(html, baseUrl) {
    const $ = cheerio.load(html);
    const links = new Set();

    // Patterns that indicate article pages
    const articlePatterns = [
        /\/news\//i, /\/article\//i, /\/story\//i, /\/post\//i, /\/\d{4}\/\d{2}\//,
        /\/world\//i, /\/politics\//i, /\/business\//i, /\/technology\//i,
        /\/markets\//i, /\/economy\//i, /\/finance\//i, /\/legal\//i,
        /\/sustainability\//i, /\/breakingviews\//i,
    ];

    $('a[href]').each((_, el) => {
        const href = $(el).attr('href');
        if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;

        try {
            const absoluteUrl = new URL(href, baseUrl).toString();
            const isArticle = articlePatterns.some((pattern) => pattern.test(absoluteUrl));
            if (isArticle) {
                links.add(absoluteUrl);
            }
        } catch {
            // Invalid URL, skip
        }
    });

    return [...links].slice(0, MAX_LINKS);
}

/**
 * Extract article content from HTML using Readability.
 */
// Silent virtualConsole — suppresses noisy jsdom CSS parse errors from Render logs
const silentConsole = new VirtualConsole();
silentConsole.sendTo(console, { omitJSDOMErrors: true });

/**
 * Strip heavy tags (style, script, svg, noscript) before jsdom parsing.
 * This dramatically reduces DOM memory usage — jsdom stores everything in RAM.
 */
function stripHeavyTags(html) {
    return html
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<svg[\s\S]*?<\/svg>/gi, '')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
        .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
        .replace(/<link[^>]*>/gi, '');
}

function extractContent(html, url) {
    let dom;
    try {
        const stripped = stripHeavyTags(html);
        dom = new JSDOM(stripped, { url, virtualConsole: silentConsole });
        const reader = new Readability(dom.window.document);
        const article = reader.parse();

        // Extract what we need BEFORE clearing
        const result = article?.textContent ? {
            title: article.title || '',
            content: article.textContent.replace(/\s+/g, ' ').trim().substring(0, 15000),
            publishedAt: new Date(),
        } : null;

        return result;
    } catch {
        return null;
    } finally {
        // Explicitly release DOM to help GC — critical for Render memory limits
        if (dom) {
            try { dom.window.close(); } catch { }
            dom = null;
        }
    }
}

/**
 * Crawl an HTML source: fetch homepage, extract links, scrape articles.
 * @param {Object} source - Source record
 * @param {string[]} keywords - Watch keywords
 * @returns {Promise<{ sourceId, articlesFound, articlesSaved, errors }>}
 */
async function crawlHtmlSourceInternal(source, keywords) {
    const result = { sourceId: source.id, articlesFound: 0, articlesSaved: 0, errors: [] };

    try {
        // 1. Fetch homepage
        const html = await fetchPage(source.url);
        if (!html) {
            await updateSourceScrapeStatus(source.id, false, 'Failed to fetch homepage');
            return result;
        }

        // 2. Extract article links
        const links = extractArticleLinks(html, source.url).slice(0, MAX_ARTICLES);
        result.articlesFound = links.length;

        // 3. Process in batches
        for (let i = 0; i < links.length; i += CONCURRENT_BATCH_SIZE) {
            const batch = links.slice(i, i + CONCURRENT_BATCH_SIZE);
            const promises = batch.map(async (link) => {
                const articleTimeout = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Article processing timeout 20s')), 20000)
                );
                try {
                    await Promise.race([
                        (async () => {
                            const pageHtml = await fetchPage(link);
                            if (!pageHtml) return;

                            const articleData = extractContent(pageHtml, link);
                            if (!articleData || articleData.content.length < 100) return;

                            const match = matchArticle(
                                { title: articleData.title, content: articleData.content },
                                keywords
                            );

                            // For brief sources: require topic word in TITLE
                            // For other sources: require keyword match
                            if (!match.matched) {
                                if (!source.briefSource) return;
                                if (!topicRelevant(articleData.title || '', source.topicWords)) return;
                            }

                            const matchedKws = match.matchedKeywords.length > 0
                                ? match.matchedKeywords
                                : ['topic_relevant'];

                            const saveResult = await saveArticle({
                                title: articleData.title || 'Untitled',
                                content: articleData.content,
                                url: link,
                                publishedAt: articleData.publishedAt,
                                sourceId: source.id,
                                clientId: source.client_id,
                                matchedKeywords: matchedKws,
                            });

                            if (saveResult.saved) {
                                result.articlesSaved++;
                            }
                        })(),
                        articleTimeout,
                    ]);
                } catch (error) {
                    result.errors.push({ url: link, error: error.message });
                }
            });

            await Promise.allSettled(promises);
        }

        await updateSourceScrapeStatus(source.id, true);
        log.scraper.info('HTML crawl complete', {
            source: source.name || source.url,
            found: result.articlesFound,
            saved: result.articlesSaved,
        });
    } catch (error) {
        await updateSourceScrapeStatus(source.id, false, error.message);
        result.errors.push({ error: error.message });
        log.scraper.error('HTML crawl failed', { source: source.url, error: error.message });
    }

    return result;
}

export async function crawlHtmlSource(source, keywords) {
    const result = { sourceId: source.id, articlesFound: 0, articlesSaved: 0, errors: [] };
    try {
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Source timeout after 90s')), 90000)
        );
        return await Promise.race([
            crawlHtmlSourceInternal(source, keywords),
            timeoutPromise,
        ]);
    } catch (err) {
        log.scraper.warn('HTML source timed out or crashed', {
            source: source.name || source.url,
            error: err.message,
        });
        await updateSourceScrapeStatus(source.id, false, err.message);
        return { ...result, errors: [{ error: err.message }] };
    }
}
