// ============================================================
// ROBIN OSINT — Browser Crawler (Puppeteer + @sparticuz/chromium)
// For JS-heavy and anti-bot protected sources
// Uses lightweight chromium for cloud deployment compatibility
// ============================================================

import puppeteer from 'puppeteer-core';
import * as cheerio from 'cheerio';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { matchArticle } from '../services/keyword-matcher.js';
import { saveArticle, updateSourceScrapeStatus } from '../services/article-saver.js';
import { log } from '../lib/logger.js';

const MAX_CONCURRENT_PAGES = 2;
const MAX_ARTICLES = 10;

/**
 * Get the Chromium executable path.
 * In serverless/cloud: uses @sparticuz/chromium (compressed, ~50MB)
 * In local dev: uses locally installed Chrome/Chromium
 */
async function getBrowserInstance() {
    // If CHROME_PATH is explicitly set, use it directly
    if (process.env.CHROME_PATH) {
        return await puppeteer.launch({
            headless: 'new',
            executablePath: process.env.CHROME_PATH,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
        });
    }

    try {
        // Try serverless chromium first (cloud/Render/Lambda)
        const chromium = await import('@sparticuz/chromium');
        const execPath = await chromium.default.executablePath();
        // `return await` is required — without it, ENOENT from launch() escapes the catch block
        return await puppeteer.launch({
            args: chromium.default.args,
            defaultViewport: chromium.default.defaultViewport,
            executablePath: execPath,
            headless: chromium.default.headless,
        });
    } catch {
        // Fallback: local Chrome/Edge for development (Windows, macOS, Linux)
        const fs = await import('fs');
        const possiblePaths = [
            // Windows Chrome
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
            // Windows Edge (pre-installed on Win10+/Win11)
            'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
            'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
            // macOS
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
            // Linux
            '/usr/bin/google-chrome',
            '/usr/bin/chromium-browser',
            '/usr/bin/chromium',
        ];

        let execPath = null;
        for (const p of possiblePaths) {
            if (p && fs.existsSync(p)) { execPath = p; break; }
        }

        if (!execPath) {
            throw new Error('No Chrome/Edge/Chromium found. Set CHROME_PATH env var to your browser executable.');
        }

        return await puppeteer.launch({
            headless: 'new',
            executablePath: execPath,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
        });
    }
}

/**
 * Extract article links from rendered HTML using Cheerio.
 */
function extractArticleLinks(html, baseUrl) {
    const $ = cheerio.load(html);
    const links = new Set();
    const patterns = [/\/news\//i, /\/article\//i, /\/story\//i, /\/post\//i, /\/\d{4}\/\d{2}\//];

    $('a[href]').each((_, el) => {
        const href = $(el).attr('href');
        if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
        try {
            const absoluteUrl = new URL(href, baseUrl).toString();
            if (patterns.some((p) => p.test(absoluteUrl))) links.add(absoluteUrl);
        } catch { /* skip invalid URLs */ }
    });

    return [...links].slice(0, MAX_ARTICLES);
}

/**
 * Helper: wait for a given number of milliseconds.
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Crawl a browser-rendered source. Always closes browser in finally block.
 * @param {Object} source - Source record
 * @param {string[]} keywords - Watch keywords
 * @returns {Promise<{ sourceId, articlesFound, articlesSaved, errors }>}
 */
async function crawlBrowserSourceInternal(source, keywords) {
    const result = { sourceId: source.id, articlesFound: 0, articlesSaved: 0, errors: [] };
    let browser = null;

    try {
        browser = await getBrowserInstance();

        // 1. Navigate to source homepage
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });
        await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
        await page.goto(source.url, { waitUntil: 'networkidle0', timeout: 30000 });
        await delay(2000);

        // 2. Extract rendered HTML
        const html = await page.content();
        await page.close();

        // 3. Find article links
        const links = extractArticleLinks(html, source.url);
        result.articlesFound = links.length;

        // 4. Process articles (respecting MAX_CONCURRENT_PAGES)
        for (let i = 0; i < links.length; i++) {
            const link = links[i];
            let articlePage = null;

            try {
                articlePage = await browser.newPage();
                await articlePage.goto(link, { waitUntil: 'domcontentloaded', timeout: 20000 });

                // Wait for content to load
                await articlePage.waitForSelector('article, main, .article-body', { timeout: 5000 }).catch(() => { });

                const articleHtml = await articlePage.content();
                const dom = new JSDOM(articleHtml, { url: link });
                const reader = new Readability(dom.window.document);
                const article = reader.parse();

                if (article && article.textContent && article.textContent.length >= 100) {
                    const match = matchArticle(
                        { title: article.title || '', content: article.textContent },
                        keywords
                    );

                    if (match.matched) {
                        const saveResult = await saveArticle({
                            title: article.title || 'Untitled',
                            content: article.textContent.replace(/\s+/g, ' ').trim().substring(0, 15000),
                            url: link,
                            publishedAt: new Date(),
                            sourceId: source.id,
                            clientId: source.client_id,
                            matchedKeywords: match.matchedKeywords,
                        });

                        if (saveResult.saved) result.articlesSaved++;
                    }
                }
            } catch (error) {
                result.errors.push({ url: link, error: error.message });
            } finally {
                if (articlePage) await articlePage.close();
            }

            // Log memory every 5 articles
            if ((i + 1) % 5 === 0) {
                const mem = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
                log.scraper.info('Browser crawler memory', { heapMB: mem, processed: i + 1 });
            }
        }

        await updateSourceScrapeStatus(source.id, true);
        log.scraper.info('Browser crawl complete', {
            source: source.name || source.url,
            found: result.articlesFound,
            saved: result.articlesSaved,
        });
    } catch (error) {
        await updateSourceScrapeStatus(source.id, false, error.message);
        result.errors.push({ error: error.message });
        log.scraper.error('Browser crawl failed', { source: source.url, error: error.message });
    } finally {
        // CRITICAL: Always close browser to prevent memory leaks
        if (browser) {
            await browser.close().catch(() => { });
        }
    }

    return result;
}

export async function crawlBrowserSource(source, keywords) {
    const result = { sourceId: source.id, articlesFound: 0, articlesSaved: 0, errors: [] };
    try {
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Browser source timeout after 120s')), 120000)
        );
        return await Promise.race([
            crawlBrowserSourceInternal(source, keywords),
            timeoutPromise,
        ]);
    } catch (err) {
        log.scraper.warn('Browser source timed out or crashed', {
            source: source.name || source.url,
            error: err.message,
        });
        await updateSourceScrapeStatus(source.id, false, err.message);
        return { ...result, errors: [{ error: err.message }] };
    }
}
