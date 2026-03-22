// ============================================================
// ROBIN OSINT — Article Saver Service
// Validates, deduplicates, and persists articles to Supabase
// ============================================================

import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { log } from '../lib/logger.js';

// BUG FIX #25: Per-source serialization queue to prevent scrape-count race conditions.
// When two concurrent scrapes finish for the same source, the read-then-write pattern
// causes both to read the same count and each write +1, losing one increment.
// Serializing updates per sourceId ensures counts are always accurate.
const _sourceUpdateQueues = new Map();
import { normalizeUrl, isDuplicate, generateContentHash, generateTitleHash, findCrossSourceDuplicate } from './dedup-checker.js';

// ── Government / institutional domain detection ──────────────
// Known government TLDs and institutional domains that should be
// tagged as 'govt_release' instead of 'article'.
const GOVT_DOMAINS = [
    // International org TLDs
    '.int',
    // Known international institutions
    'imf.org', 'worldbank.org', 'un.org', 'bis.org', 'oecd.org',
    'wto.org', 'who.int', 'unicef.org', 'undp.org', 'unep.org',
    'iea.org', 'iaea.org', 'wef.org', 'g20.org', 'g7.org',
    // Central banks
    'federalreserve.gov', 'ecb.europa.eu', 'bankofengland.co.uk',
    'boj.or.jp', 'rbi.org.in', 'sbp.org.pk', 'pboc.gov.cn',
    'bundesbank.de', 'banquedefrance.fr', 'bankofcanada.ca',
    'rba.gov.au', 'snb.ch', 'riksbank.se', 'norges-bank.no',
    // Regulatory bodies
    'sec.gov', 'cftc.gov', 'fdic.gov', 'occ.gov', 'secp.gov.pk',
    'fca.org.uk', 'esma.europa.eu',
    // EU institutions
    'europa.eu', 'eea.europa.eu', 'eur-lex.europa.eu',
];

/**
 * Detect the appropriate content_type for a URL.
 * Returns 'govt_release' for government/institutional sources,
 * 'article' for everything else.
 * @param {string} url
 * @returns {'govt_release'|'article'}
 */
function detectContentType(url) {
    if (!url) return 'article';
    try {
        const { hostname } = new URL(url);
        const host = hostname.toLowerCase();
        // Check .gov TLD (any country)
        if (host.endsWith('.gov') || host.includes('.gov.')) return 'govt_release';
        // Check .int TLD
        if (host.endsWith('.int')) return 'govt_release';
        // Check known institutional domains
        for (const domain of GOVT_DOMAINS) {
            if (host === domain || host.endsWith('.' + domain) || host.includes(domain)) {
                return 'govt_release';
            }
        }
    } catch { /* invalid URL, fall through */ }
    return 'article';
}



// Zod validation schema for incoming articles
const ArticleSchema = z.object({
    title: z.string().min(5).max(500),
    content: z.string().min(100),
    url: z.string().url(),
    publishedAt: z.coerce.date(),
    sourceName: z.string().optional(),
    sourceId: z.string().uuid(),
    clientId: z.string().uuid(),
    matchedKeywords: z.array(z.string()).default([]),
    imageUrl: z.string().url().optional().nullable(),
});

/**
 * Validate, deduplicate, and save an article to the database.
 * @param {Object} rawArticle - Raw article data
 * @returns {Promise<{ saved: boolean, articleId?: string, reason?: string }>}
 */
export async function saveArticle(rawArticle) {
    // 1. Validate
    const parsed = ArticleSchema.safeParse(rawArticle);
    if (!parsed.success) {
        const errors = parsed.error.issues.map((i) => `${i.path}: ${i.message}`).join(', ');
        log.scraper.warn('Article validation failed', { errors });
        return { saved: false, reason: `validation_failed: ${errors}` };
    }

    const article = parsed.data;

    // 2. Normalize URL
    const normalizedUrl = normalizeUrl(article.url);

    // 3. Check for duplicates
    const dupResult = await isDuplicate(normalizedUrl, article.content, article.clientId);
    if (dupResult.isDuplicate) {
        return { saved: false, reason: `duplicate: ${dupResult.reason}` };
    }

    // 4. Generate content hash and title hash
    const contentHash = generateContentHash(article.content);
    const titleHash = generateTitleHash(article.title);

    // 5. Check for cross-source duplicates (same story, different source)
    //    This does NOT block saving — it links articles together for intelligence
    const crossSourceMatch = await findCrossSourceDuplicate(
        article.title, article.sourceId, article.clientId
    );

    // 6. Insert into database
    try {
        const insertData = {
            client_id: article.clientId,
            source_id: article.sourceId,
            title: article.title,
            content: article.content,
            url: normalizedUrl,
            content_hash: contentHash,
            title_hash: titleHash,
            published_at: article.publishedAt.toISOString(),
            matched_keywords: article.matchedKeywords,
            analysis_status: 'pending',
        };

        // Link to original if cross-source duplicate found
        if (crossSourceMatch) {
            insertData.cross_source_duplicate_of = crossSourceMatch;
        }

        const { data, error } = await supabase
            .from('articles')
            .insert(insertData)
            .select('id')
            .single();

        if (error) {
            // Handle race condition (unique constraint violation)
            if (error.code === '23505') {
                return { saved: false, reason: 'duplicate_race_condition' };
            }
            // Handle missing columns (pre-migration) — retry without new fields
            if (error.message?.includes('title_hash') || error.message?.includes('cross_source_duplicate_of')) {
                log.scraper.warn('New columns not yet migrated, saving without cross-source dedup');
                delete insertData.title_hash;
                delete insertData.cross_source_duplicate_of;
                const { data: retryData, error: retryError } = await supabase
                    .from('articles')
                    .insert(insertData)
                    .select('id')
                    .single();
                if (retryError) {
                    if (retryError.code === '23505') return { saved: false, reason: 'duplicate_race_condition' };
                    throw retryError;
                }
                log.scraper.info('Article saved (no title_hash)', { title: article.title.substring(0, 60), id: retryData.id });
                return { saved: true, articleId: retryData.id };
            }
            throw error;
        }

        log.scraper.info('Article saved', { title: article.title.substring(0, 60), id: data.id });

        // Dual-write to content_items (graceful — won't break if migration hasn't run)
        try {
            await supabase.from('content_items').upsert({
                id: data.id,
                client_id: article.clientId,
                source_id: article.sourceId,
                content_type: detectContentType(normalizedUrl),
                title: article.title,
                content: article.content,
                url: normalizedUrl,
                content_hash: contentHash,
                title_hash: titleHash,
                published_at: article.publishedAt.toISOString(),
                matched_keywords: article.matchedKeywords,
                analysis_status: 'pending',
                type_metadata: article.imageUrl ? { image_url: article.imageUrl } : {},
                ...(crossSourceMatch ? { cross_source_duplicate_of: crossSourceMatch } : {}),
            }, { onConflict: 'id' });
        } catch (e) {
            // Silently ignore — content_items table may not exist yet
            log.scraper.debug('content_items dual-write skipped', { reason: e.message });
        }

        return { saved: true, articleId: data.id };
    } catch (error) {
        log.scraper.error('Failed to save article', { error: error.message, url: normalizedUrl });
        return { saved: false, reason: `db_error: ${error.message}` };
    }
}

/**
 * Update a source's scrape status after a crawl attempt.
 * @param {string} sourceId - Source UUID
 * @param {boolean} success - Whether the scrape succeeded
 * @param {string} [errorMessage] - Error message if failed
 */
export async function updateSourceScrapeStatus(sourceId, success, errorMessage = null) {
    // Serialize updates for the same sourceId to prevent read-then-write race conditions
    const prev = _sourceUpdateQueues.get(sourceId) || Promise.resolve();
    const next = prev.then(() => _doUpdateSourceScrapeStatus(sourceId, success, errorMessage));
    _sourceUpdateQueues.set(sourceId, next.catch(() => {}));
    return next;
}

async function _doUpdateSourceScrapeStatus(sourceId, success, errorMessage = null) {
    try {
        const countColumn = success ? 'scrape_success_count' : 'scrape_fail_count';
        const { data } = await supabase
            .from('sources')
            .select(countColumn)
            .eq('id', sourceId)
            .single();

        const updates = {
            last_scraped_at: new Date().toISOString(),
            [countColumn]: (data?.[countColumn] || 0) + 1,
        };
        if (success) {
            updates.last_scrape_error = null;
        } else {
            updates.last_scrape_error = errorMessage;
        }

        await supabase.from('sources').update(updates).eq('id', sourceId);
    } catch (error) {
        log.scraper.error('Failed to update source status', { sourceId, error: error.message });
    }
}
