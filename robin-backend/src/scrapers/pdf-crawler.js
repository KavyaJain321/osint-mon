// ============================================================
// ROBIN OSINT — PDF Crawler
// Downloads PDFs from source pages using Playwright (handles JS-rendered sites)
// Falls back to raw HTML fetch for simple sites
// For: government press releases, IMF/World Bank reports, SEC filings
// ============================================================

import * as cheerio from 'cheerio';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParseModule = require('pdf-parse');
// pdf-parse v2 exports PDFParse as a named class
// Usage: new PDFParse({ data: buffer }).getText()
const { PDFParse } = pdfParseModule;
import { matchArticle } from '../services/keyword-matcher.js';
import { updateSourceScrapeStatus } from '../services/article-saver.js';
import { saveContent } from '../services/content-saver.js';
import { log } from '../lib/logger.js';

const MAX_PDF_LINKS = 10;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const CONCURRENT_DOWNLOADS = 2;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const FETCH_TIMEOUT = 12000; // Fail fast on slow servers

// ── PDF text extraction ──────────────────────────────────────
/**
 * Extract text content from a PDF buffer.
 */
async function extractPdfContent(buffer, url) {
    try {
        if (!PDFParse) {
            log.scraper.warn('pdf-parse not available', { url });
            return null;
        }
        // pdf-parse v2 API: new PDFParse({ data: buffer }).getText()
        const parser = new PDFParse({ data: buffer });
        const data = await parser.getText();
        const rawText = typeof data === 'string' ? data : (data?.text || '');
        if (!rawText || rawText.length < 50) return null;

        const content = rawText
            .replace(/\s+/g, ' ')
            .replace(/[^\x20-\x7E\n]/g, ' ')
            .trim()
            .substring(0, 15000);

        const title = content.split(/[\n.]/)[0]?.substring(0, 150).trim()
            || url.split('/').pop()?.replace('.pdf', '').replace(/-/g, ' ')
            || 'Untitled PDF';

        return { title, content };
    } catch (error) {
        log.scraper.warn('PDF parse failed', { url, error: error.message });
        return null;
    }
}

// ── PDF download ─────────────────────────────────────────────
async function downloadPdf(pdfUrl) {
    let timeout;
    try {
        const controller = new AbortController();
        timeout = setTimeout(() => controller.abort(), 15000);
        const response = await fetch(pdfUrl, {
            signal: controller.signal,
            headers: { 'User-Agent': USER_AGENT },
        });
        clearTimeout(timeout);

        if (!response.ok) return null;

        // Verify it is actually a PDF
        const ct = response.headers.get('content-type') || '';
        const isPdf = ct.includes('application/pdf') || ct.includes('octet-stream') ||
            pdfUrl.toLowerCase().split('?')[0].endsWith('.pdf');
        if (!isPdf) return null;

        const contentLength = parseInt(response.headers.get('content-length') || '0');
        const MAX_PDF_SIZE = 10 * 1024 * 1024; // 10 MB limit
        if (contentLength > MAX_PDF_SIZE) {
            log.scraper.warn('PDF too large, skipping', {
                url: pdfUrl.substring(0, 80),
                sizeMB: Math.round(contentLength / 1024 / 1024)
            });
            return null;
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.byteLength > MAX_FILE_SIZE) return null;
        // Quick check — PDF files start with %PDF
        if (buffer.length > 4 && buffer.toString('ascii', 0, 4) !== '%PDF') return null;
        return buffer;
    } catch {
        if (timeout) clearTimeout(timeout);
        return null;
    }
}

// ── PDF link extraction from HTML ────────────────────────────
function extractPdfLinksFromHtml(html, baseUrl) {
    const $ = cheerio.load(html);
    const links = new Set();

    $('a[href]').each((_, el) => {
        const href = $(el).attr('href');
        if (!href) return;
        try {
            const abs = new URL(href, baseUrl).toString();
            const absLower = abs.toLowerCase().split('?')[0];
            // Only accept links that are clearly PDF files
            if (absLower.endsWith('.pdf')) {
                links.add(abs);
            }
        } catch { /* invalid URL */ }
    });

    return [...links].slice(0, MAX_PDF_LINKS);
}

// ── Institution-specific API resolvers ───────────────────────
/**
 * For known institutions, use their public document APIs instead of scraping.
 * Much faster and more reliable than scraping JS-rendered pages.
 */
async function getPdfLinksFromApi(sourceUrl, keywords) {
    const url = sourceUrl.toLowerCase();

    // World Bank Open Knowledge Repository
    if (url.includes('worldbank.org') || url.includes('openknowledge.worldbank.org')) {
        try {
            const query = keywords.slice(0, 3).join(' ');
            const apiUrl = `https://search.worldbank.org/api/v2/wds?format=json&rows=8&fl=id,display_title,pdfurl,docdt&os=0&apilang=en&qterm=${encodeURIComponent(query)}&strdate=01/01/2024&enddate=12/31/2026`;
            const resp = await fetch(apiUrl, { headers: { 'User-Agent': USER_AGENT } });
            if (!resp.ok) return [];
            const data = await resp.json();
            const docs = Object.values(data.documents || {});
            const pdfUrls = docs
                .filter(d => d.pdfurl)
                .map(d => d.pdfurl)
                .filter(u => u && u.toLowerCase().includes('.pdf'))
                .slice(0, MAX_PDF_LINKS);
            log.scraper.info('World Bank API returned PDFs', { count: pdfUrls.length });
            return pdfUrls;
        } catch (e) {
            log.scraper.warn('World Bank API failed', { error: e.message });
            return [];
        }
    }

    // IMF Publications 
    if (url.includes('imf.org')) {
        try {
            const query = keywords.slice(0, 3).join(' ');
            const apiUrl = `https://www.imf.org/external/search.asp?q=${encodeURIComponent(query)}&json=true&rows=8&type=publication`;
            const resp = await fetch(apiUrl, { headers: { 'User-Agent': USER_AGENT } });
            if (!resp.ok) return [];
            const data = await resp.json();
            const pdfUrls = (data.response?.docs || [])
                .filter(d => d.pdf_url)
                .map(d => d.pdf_url)
                .filter(u => u?.toLowerCase().endsWith('.pdf'))
                .slice(0, MAX_PDF_LINKS);
            log.scraper.info('IMF API returned PDFs', { count: pdfUrls.length });
            return pdfUrls;
        } catch {
            return [];
        }
    }

    // BIS Working Papers
    if (url.includes('bis.org')) {
        try {
            const resp = await fetch('https://www.bis.org/doclist/wppubls.rss', { headers: { 'User-Agent': USER_AGENT } });
            if (!resp.ok) return [];
            const xml = await resp.text();
            const pdfMatches = [...xml.matchAll(/https?:\/\/www\.bis\.org\/[^\s<"]+\.pdf/g)];
            return [...new Set(pdfMatches.map(m => m[0]))].slice(0, MAX_PDF_LINKS);
        } catch { return []; }
    }

    // UNEP / UN publications - use their OAI endpoint or RSS
    if (url.includes('unep.org') || url.includes('un.org')) {
        try {
            const resp = await fetch(`${sourceUrl}rss`, { headers: { 'User-Agent': USER_AGENT } });
            if (!resp.ok) return [];
            const xml = await resp.text();
            const pdfMatches = [...xml.matchAll(/https?:\/\/[^\s<"]+\.pdf/g)];
            return [...new Set(pdfMatches.map(m => m[0]))].slice(0, MAX_PDF_LINKS);
        } catch { return []; }
    }

    // EEA Publications
    if (url.includes('eea.europa.eu')) {
        try {
            const resp = await fetch('https://www.eea.europa.eu/en/publications/rss.xml', { headers: { 'User-Agent': USER_AGENT } });
            if (!resp.ok) return [];
            const xml = await resp.text();
            const pdfMatches = [...xml.matchAll(/https?:\/\/[^\s<"]+\.pdf/g)];
            return [...new Set(pdfMatches.map(m => m[0]))].slice(0, MAX_PDF_LINKS);
        } catch { return []; }
    }

    return []; // Not a known institution
}



// ── Browser-based PDF link extractor (Puppeteer) ─────────────
/**
 * Get Chromium browser instance for PDF link extraction.
 * Cloud: @sparticuz/chromium | Local: system Chrome
 */
async function getPdfBrowserInstance() {
    const puppeteer = (await import('puppeteer-core')).default;
    try {
        const chromium = await import('@sparticuz/chromium');
        const execPath = await chromium.default.executablePath();
        return puppeteer.launch({
            args: chromium.default.args,
            defaultViewport: chromium.default.defaultViewport,
            executablePath: execPath,
            headless: chromium.default.headless,
        });
    } catch {
        const fs = await import('fs');
        const possiblePaths = [
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
        ];
        let execPath = null;
        for (const p of possiblePaths) {
            if (p && fs.existsSync(p)) { execPath = p; break; }
        }
        if (!execPath) throw new Error('No Chrome/Chromium found');
        return puppeteer.launch({
            headless: 'new',
            executablePath: process.env.CHROME_PATH || execPath,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
        });
    }
}

/**
 * Use Puppeteer to render the page with Chromium, then extract PDF links.
 * Handles JS-rendered sites (World Bank, UNEP, FAO, IMF, EEA, etc.)
 *
 * @param {string} url - Source page URL
 * @returns {Promise<string[]>} Array of absolute PDF URLs
 */
async function extractPdfLinksWithBrowser(url) {
    let browser = null;
    try {
        browser = await getPdfBrowserInstance();
        const page = await browser.newPage();
        await page.setUserAgent(USER_AGENT);

        // Intercept PDF downloads — collect their URLs instead of downloading them
        const pdfUrls = new Set();
        page.on('request', (req) => {
            const reqUrl = req.url();
            if (
                reqUrl.toLowerCase().endsWith('.pdf') ||
                req.resourceType() === 'document' && reqUrl.includes('.pdf')
            ) {
                pdfUrls.add(reqUrl);
            }
        });

        await page.goto(url, { waitUntil: 'networkidle0', timeout: 20000 });

        // Wait for dynamic content
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Extract all links from the rendered DOM
        const links = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('a[href]'))
                .map(el => el.href)
                .filter(Boolean);
        });

        // Filter: only include actual .pdf URLs
        for (const link of links) {
            try {
                const abs = new URL(link, url).toString();
                const absLower = abs.toLowerCase().split('?')[0];
                if (absLower.endsWith('.pdf') || /\/bitstream\/.*\.pdf/i.test(abs)) {
                    pdfUrls.add(abs);
                }
            } catch { /* skip */ }
        }

        await browser.close();
        browser = null;

        const results = [...pdfUrls].slice(0, MAX_PDF_LINKS);
        log.scraper.info('Browser PDF link extraction complete', { url, found: results.length });
        return results;
    } catch (error) {
        log.scraper.warn('Browser PDF extraction failed', { url, error: error.message });
        return [];
    } finally {
        if (browser) await browser.close().catch(() => { });
    }
}

// ── Main crawler ─────────────────────────────────────────────
/**
 * Crawl a PDF source using Playwright for JS-rendered sites.
 * Falls back to raw HTML fetch for simple sites.
 *
 * @param {Object} source - Source record with {id, client_id, url, name}
 * @param {string[]} keywords - Watch keywords
 * @returns {Promise<{sourceId, articlesFound, articlesSaved, errors}>}
 */
async function crawlPdfSourceInternal(source, keywords) {
    const result = { sourceId: source.id, articlesFound: 0, articlesSaved: 0, errors: [] };

    try {
        let pdfUrls = [];

        // 1. Check if source URL IS a direct PDF
        const probeController = new AbortController();
        const probeTimeout = setTimeout(() => probeController.abort(), 15000);
        let isDirectPdf = false;
        try {
            const probe = await fetch(source.url, {
                method: 'HEAD',
                signal: probeController.signal,
                headers: { 'User-Agent': USER_AGENT },
            });
            clearTimeout(probeTimeout);
            if (probe.ok) {
                const ct = probe.headers.get('content-type') || '';
                isDirectPdf = ct.includes('application/pdf') || source.url.toLowerCase().endsWith('.pdf');
            }
        } catch { clearTimeout(probeTimeout); }

        if (isDirectPdf) {
            pdfUrls = [source.url];
        } else {
            // 2. Try institution-specific APIs first (World Bank, IMF, BIS, etc.)
            const apiLinks = await getPdfLinksFromApi(source.url, keywords);
            if (apiLinks.length > 0) {
                log.scraper.info('PDF: institution API found links', { count: apiLinks.length, source: source.name });
                pdfUrls = apiLinks;
            } else {
                // 3. Try fast raw HTML fetch (works for simple/static sites)
                log.scraper.info('PDF: trying static HTML fetch', { source: source.name });
                let htmlLinks = [];
                try {
                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), 15000);
                    const resp = await fetch(source.url, {
                        signal: controller.signal,
                        headers: { 'User-Agent': USER_AGENT },
                    });
                    clearTimeout(timeout);
                    if (resp.ok) {
                        const html = await resp.text();
                        htmlLinks = extractPdfLinksFromHtml(html, source.url);
                    }
                } catch { /* fall through to Playwright */ }

                if (htmlLinks.length > 0) {
                    log.scraper.info('PDF: static HTML found links', { count: htmlLinks.length });
                    pdfUrls = htmlLinks;
                } else {
                    // 4. Fallback to Playwright for JS-rendered sites
                    log.scraper.info('PDF: no static links found, using browser', { source: source.name });
                    pdfUrls = await extractPdfLinksWithBrowser(source.url);
                }
            } // end else (no API links)
        } // end else (not direct PDF)

        result.articlesFound = pdfUrls.length;

        if (pdfUrls.length === 0) {
            log.scraper.info('No PDF links found', { source: source.name || source.url });
            await updateSourceScrapeStatus(source.id, true);
            return result;
        }

        log.scraper.info(`PDF: processing ${pdfUrls.length} PDFs`, { source: source.name });

        // 5. Download and process PDFs in batches
        for (let i = 0; i < pdfUrls.length; i += CONCURRENT_DOWNLOADS) {
            const batch = pdfUrls.slice(i, i + CONCURRENT_DOWNLOADS);
            const promises = batch.map(async (pdfUrl) => {
                try {
                    const buffer = await downloadPdf(pdfUrl);
                    if (!buffer) return;

                    const extracted = await extractPdfContent(buffer, pdfUrl);
                    if (!extracted || extracted.content.length < 100) return;

                    const match = matchArticle(
                        { title: extracted.title, content: extracted.content },
                        keywords
                    );
                    if (!match.matched) return;

                    const saveResult = await saveContent({
                        contentType: 'pdf',
                        title: `[PDF] ${extracted.title}`,
                        content: extracted.content,
                        url: pdfUrl,
                        publishedAt: new Date(),
                        sourceId: source.id,
                        clientId: source.client_id,
                        matchedKeywords: match.matchedKeywords,
                        typeMetadata: { document_type: 'pdf', source_name: source.name },
                    });

                    if (saveResult.saved) {
                        result.articlesSaved++;
                        log.scraper.info('PDF saved', {
                            title: extracted.title.substring(0, 60),
                        });
                    }
                } catch (error) {
                    result.errors.push({ url: pdfUrl, error: error.message });
                }
            });

            await Promise.allSettled(promises);
        }

        await updateSourceScrapeStatus(source.id, true);
        log.scraper.info('PDF crawl complete', {
            source: source.name || source.url,
            found: result.articlesFound,
            saved: result.articlesSaved,
        });
    } catch (error) {
        await updateSourceScrapeStatus(source.id, false, error.message);
        result.errors.push({ error: error.message });
        log.scraper.error('PDF crawl failed', { source: source.url, error: error.message });
    }

    return result;
}

export async function crawlPdfSource(source, keywords) {
    const result = { sourceId: source.id, articlesFound: 0, articlesSaved: 0, errors: [] };
    try {
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('PDF source timeout after 60s')), 60000)
        );
        return await Promise.race([
            crawlPdfSourceInternal(source, keywords),
            timeoutPromise,
        ]);
    } catch (err) {
        log.scraper.warn('PDF source timed out or crashed', {
            source: source.name || source.url,
            error: err.message,
        });
        return { ...result, errors: [{ error: err.message }] };
    }
}
