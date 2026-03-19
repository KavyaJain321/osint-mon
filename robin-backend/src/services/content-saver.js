// ============================================================
// ROBIN OSINT — Universal Content Saver
// Saves any content type to the content_items table with
// type-specific metadata. Also maintains backward compat
// with the articles table for type='article'.
// ============================================================

import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { log } from '../lib/logger.js';
import { normalizeUrl, generateContentHash, generateTitleHash } from './dedup-checker.js';

// ── Type-specific metadata schemas ────────────────────────

const ArticleMeta = z.object({
    word_count: z.number().optional(),
    author: z.string().optional(),
    publication: z.string().optional(),
    section: z.string().optional(),
}).passthrough();

const VideoMeta = z.object({
    duration_seconds: z.number().optional(),
    channel_name: z.string().optional(),
    view_count: z.number().optional(),
    language: z.string().optional(),
    has_captions: z.boolean().optional(),
}).passthrough();

const PdfMeta = z.object({
    page_count: z.number().optional(),
    file_size_bytes: z.number().optional(),
    document_type: z.string().optional(),
    issuing_authority: z.string().optional(),
}).passthrough();

const TweetMeta = z.object({
    retweet_count: z.number().optional(),
    like_count: z.number().optional(),
    reply_count: z.number().optional(),
    is_thread: z.boolean().optional(),
}).passthrough();

const RedditMeta = z.object({
    subreddit: z.string().optional(),
    upvotes: z.number().optional(),
    comment_count: z.number().optional(),
    flair: z.string().optional(),
}).passthrough();

const GovtReleaseMeta = z.object({
    department: z.string().optional(),
    release_number: z.string().optional(),
    official_category: z.string().optional(),
    officials_mentioned: z.array(z.string()).optional(),
}).passthrough();

const NewsApiMeta = z.object({
    api_source: z.string().optional(),
    original_source: z.string().optional(),
    category: z.string().optional(),
}).passthrough();

const META_SCHEMAS = {
    article: ArticleMeta,
    video: VideoMeta,
    pdf: PdfMeta,
    tweet: TweetMeta,
    reddit: RedditMeta,
    govt_release: GovtReleaseMeta,
    news_api_article: NewsApiMeta,
    press_release: GovtReleaseMeta,
    podcast: VideoMeta,
    tv_transcript: VideoMeta,
    social_post: TweetMeta,
};

// ── Main content schema ────────────────────────────────────

// These MUST match the DB CHECK constraint on content_items.content_type
const VALID_TYPES = [
    'article', 'video', 'pdf', 'tweet',
    'reddit', 'govt_release',
    'press_release', 'podcast', 'tv_transcript', 'social_post',
];

const ContentSchema = z.object({
    contentType: z.enum(VALID_TYPES),
    title: z.string().min(3).max(1000),
    content: z.string().min(20), // more lenient than articles (tweets can be short)
    url: z.string().url(),
    publishedAt: z.coerce.date(),
    sourceId: z.string().uuid().optional(),
    clientId: z.string().uuid(),
    matchedKeywords: z.array(z.string()).default([]),
    language: z.string().default('en'),
    sourceTier: z.number().int().min(1).max(3).default(2),
    typeMetadata: z.record(z.any()).default({}),
});

// ── Save any content type ──────────────────────────────────

/**
 * Save a content item of any type to the content_items table.
 *
 * @param {Object} raw - Raw content data
 * @returns {Promise<{ saved: boolean, contentId?: string, reason?: string }>}
 */
export async function saveContent(raw) {
    // 1. Validate base fields
    const parsed = ContentSchema.safeParse(raw);
    if (!parsed.success) {
        const errors = parsed.error.issues.map(i => `${i.path}: ${i.message}`).join(', ');
        log.scraper.warn('Content validation failed', { errors, type: raw?.contentType });
        return { saved: false, reason: `validation_failed: ${errors}` };
    }

    const item = parsed.data;

    // 2. Validate type-specific metadata
    const metaSchema = META_SCHEMAS[item.contentType];
    if (metaSchema) {
        const metaParsed = metaSchema.safeParse(item.typeMetadata);
        if (metaParsed.success) {
            item.typeMetadata = metaParsed.data;
        }
        // Don't reject on meta validation failure — just keep raw metadata
    }

    // 3. Normalize URL and generate hashes
    const normalizedUrl = normalizeUrl(item.url);
    const contentHash = generateContentHash(item.content);
    const titleHash = generateTitleHash(item.title);

    // 4. Check for URL-based dedup
    try {
        const { data: existing } = await supabase
            .from('content_items')
            .select('id')
            .eq('url', normalizedUrl)
            .limit(1)
            .maybeSingle();

        if (existing) {
            return { saved: false, reason: 'duplicate_url' };
        }
    } catch {
        // Table may not exist — continue
    }

    // 5. Insert into content_items
    try {
        const insertData = {
            client_id: item.clientId,
            source_id: item.sourceId || null,
            content_type: item.contentType,
            title: item.title,
            content: item.content,
            url: normalizedUrl,
            content_hash: contentHash,
            title_hash: titleHash,
            published_at: item.publishedAt.toISOString(),
            matched_keywords: Array.isArray(item.matchedKeywords) ? item.matchedKeywords : [],
            analysis_status: 'pending',
            type_metadata: item.typeMetadata,
            source_tier: item.sourceTier,
            language: item.language,
        };

        const { data, error } = await supabase
            .from('content_items')
            .insert(insertData)
            .select('id')
            .single();

        if (error) {
            if (error.code === '23505') {
                return { saved: false, reason: 'duplicate_hash' };
            }
            throw error;
        }

        log.scraper.info('Content saved', {
            type: item.contentType,
            title: item.title.substring(0, 60),
            id: data.id,
        });

        // 6. Backward compat: write ALL types to articles table to enable AI analysis
        try {
            await supabase.from('articles').upsert({
                    id: data.id,
                    client_id: item.clientId,
                    source_id: item.sourceId,
                    title: item.title,
                    content: item.content,
                    url: normalizedUrl,
                    content_hash: contentHash,
                    title_hash: titleHash,
                    published_at: item.publishedAt.toISOString(),
                    matched_keywords: item.matchedKeywords,
                    analysis_status: 'pending',
                }, { onConflict: 'id' });
            } catch {
                // Silent — articles table backward compat only
            }

        return { saved: true, contentId: data.id };

    } catch (error) {
        log.scraper.error('Failed to save content', {
            error: error.message,
            type: item.contentType,
            url: normalizedUrl,
        });
        return { saved: false, reason: `db_error: ${error.message}` };
    }
}

// ── Convenience helpers ────────────────────────────────────

export function saveArticleContent(raw) {
    return saveContent({ ...raw, contentType: 'article' });
}

export function saveVideoContent(raw) {
    return saveContent({ ...raw, contentType: 'video_transcript' });
}

export function saveRedditContent(raw) {
    return saveContent({ ...raw, contentType: 'reddit' });
}

export function saveTweetContent(raw) {
    return saveContent({ ...raw, contentType: 'tweet' });
}

export function saveNewsApiContent(raw) {
    return saveContent({ ...raw, contentType: 'news_api_article' });
}

export { VALID_TYPES };
