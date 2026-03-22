// ============================================================
// ROBIN OSINT — AI Analysis Worker
// Polls for pending articles → Groq LLM → local fallback
// ============================================================

import { supabase } from '../lib/supabase.js';
import { groqChat } from '../lib/groq.js';
import { generateAndStoreEmbedding } from '../services/embedding.js';
import { analyzeLocally } from '../services/local-analyzer.js';
import { log } from '../lib/logger.js';

const POLL_INTERVAL_MS = 60000;
const BATCH_SIZE = 2;
const DELAY_BETWEEN_MS = 2000;
// BUG FIX #31: Renamed to clarify this is a lifetime (since-startup) counter, not
// a per-batch counter. The misleading name caused confusion in log output — e.g.
// "Analyzed [5]" looks like article ID 5. Log now says "total since startup".
let analysisTotalSinceStartup = 0;

/**
 * Content-type-specific prompt instructions
 */
const TYPE_INSTRUCTIONS = {
    article: 'Analyze this news article.',
    video_transcript: 'Analyze this video transcript. Focus on key statements, speakers, and claims made in the video.',
    tweet: 'Analyze this tweet/social media post. Consider its virality potential and public sentiment impact.',
    reddit: 'Analyze this Reddit post and discussion. Consider community sentiment and grassroots opinion signals.',
    pdf_document: 'Analyze this document. Focus on official positions, policy implications, and regulatory impact.',
    govt_release: 'Analyze this government press release. Focus on policy changes, official statements, and regulatory implications.',
    news_api_article: 'Analyze this news article.',
    press_release: 'Analyze this press release. Focus on official announcements and their market/policy implications.',
    podcast: 'Analyze this podcast transcript. Focus on key opinions, expert statements, and emerging narratives.',
    tv_transcript: 'Analyze this TV segment transcript. Focus on editorial framing, guest statements, and narrative direction.',
    social_post: 'Analyze this social media post. Consider reach, engagement signals, and public sentiment.',
};

/**
 * Build the analysis prompt for a content item (article or any content type).
 */
function buildAnalysisPrompt(article, briefTopic, briefContext, keywords) {
    const content = (article.content || '').substring(0, 3000);
    const topicLabel = briefTopic || 'general monitoring';
    const contextLabel = briefContext || '';
    const contentType = article.content_type || 'article';
    const typeInstruction = TYPE_INSTRUCTIONS[contentType] || TYPE_INSTRUCTIONS.article;
    return [
        {
            role: 'system',
            content: 'You are an expert intelligence analyst specializing in media monitoring and risk assessment. Return only valid JSON.',
        },
        {
            role: 'user',
            content: `${typeInstruction}
Content type: ${contentType}
Analyze in context of: "${topicLabel}"
${contextLabel ? `Background: ${contextLabel.substring(0, 300)}` : ''}
Matched keywords: ${keywords.join(', ')}.
Title: ${article.title}
Content: ${content}
Published: ${article.published_at} | Source: ${article.source_name || 'Unknown'}

Return ONLY a JSON object IN ENGLISH (translate any non-English content to English) with:
{
  "title_en": "English translation of the title (if already English, copy it as-is)",
  "summary": "3 specific factual sentences in English",
  "sentiment": "positive|negative|neutral",
  "importance_score": 1-10,
  "importance_reason": "one sentence re: impact on the topic above",
  "narrative_frame": "crisis|recovery|accountability|conflict|human_interest|economic|none",
  "entities": { "people": [], "orgs": [], "locations": [], "figures": [] },
  "claims": [
    "Extract 2-4 specific factual assertions from the content as plain strings.",
    "Each claim must be a complete sentence stating what the content asserts as fact.",
    "Example: The Federal Reserve raised interest rates by 25 basis points.",
    "Example: SEC issued new warnings about retail trading risks."
  ]
}

IMPORTANT for "entities": Only extract entities that ACTUALLY APPEAR in the text. Do NOT invent or add entities that are not mentioned.
IMPORTANT for "claims": The claims array MUST contain 2-4 specific factual claims as simple strings. Each claim should mention specific names, numbers, dates, or events. If purely opinion, write: "This content is opinion/analysis without specific factual assertions." DO NOT return an empty claims array.

Scoring: 9-10=regulatory/legal/scandal, 7-8=financial/leadership, 5-6=industry trends, 3-4=general mention, 1-2=tangential`,
        },
    ];
}

/**
 * Parse JSON from Groq response, stripping markdown fences.
 */
function parseAnalysisResponse(text) {
    let cleaned = text.trim();
    if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }
    return JSON.parse(cleaned);
}

/**
 * Try Groq LLM analysis, fallback to local rules if all keys fail.
 */
async function getAnalysis(article, briefTopic, briefContext, keywords) {
    // Attempt 1: Groq LLM
    try {
        const messages = buildAnalysisPrompt(article, briefTopic, briefContext, keywords);
        const response = await groqChat(messages);
        const rawText = response.choices[0]?.message?.content || '';
        const analysis = parseAnalysisResponse(rawText);
        analysis._method = 'groq';
        analysis._model = response.model || 'llama-3.3-70b-versatile';

        // Enforce non-empty claims
        analysis.claims = normalizeClaims(analysis.claims, analysis.summary);

        return analysis;
    } catch (groqError) {
        log.ai.warn('Groq failed, using local fallback', {
            articleId: article.id,
            error: groqError.message?.substring(0, 100),
        });
    }

    // Attempt 2: Local rule-based analysis
    const analysis = analyzeLocally(article, briefTopic, briefContext);
    analysis._method = 'local';
    analysis.claims = normalizeClaims(analysis.claims, analysis.summary);
    return analysis;
}

/**
 * Normalize claims: convert object-format to strings, enforce non-empty.
 */
function normalizeClaims(claims, summaryFallback) {
    if (!claims || !Array.isArray(claims) || claims.length === 0) {
        return [summaryFallback || 'No specific claims extracted'];
    }

    // If LLM returned object format [{claim: "...", source: "..."}], extract the claim strings
    const normalized = claims.map(c => {
        if (typeof c === 'string') return c;
        if (typeof c === 'object' && c.claim) return c.claim;
        return null;
    }).filter(c => c && c.length > 5);

    if (normalized.length === 0) {
        return [summaryFallback || 'No specific claims extracted'];
    }
    return normalized;
}

/**
 * Analyze a single article: Groq → local fallback → save results.
 */
export async function analyzeArticle(article) {
    try {
        // [CRITICAL FIX] Verify the article still exists in the master table before wasting Groq limits!
        // We previously purged bad videos, leaving orphaned content_items that cause foreign key crashes.
        const { data: existenceCheck } = await supabase
            .from('articles')
            .select('id')
            .eq('id', article.id)
            .single();

        if (!existenceCheck) {
            log.ai.warn('Orphaned item detected! Purging from content_items to prevent infinite loop', { articleId: article.id });
            await supabase.from('content_items').delete().eq('id', article.id);
            return false;
        }

        // Mark as processing in BOTH tables
        await supabase
            .from('articles')
            .update({ analysis_status: 'processing' })
            .eq('id', article.id);

        try {
            await supabase
                .from('content_items')
                .update({ analysis_status: 'processing' })
                .eq('id', article.id);
        } catch { /* ignore if not present */ }

        // Fetch client info and active brief topic
        const { data: client } = await supabase
            .from('clients')
            .select('name, industry')
            .eq('id', article.client_id)
            .single();

        const clientName = client?.name || 'Unknown';

        // Get the active brief topic — this is what the analysis should focus on
        const { data: activeBrief } = await supabase
            .from('client_briefs')
            .select('title, problem_statement')
            .eq('client_id', article.client_id)
            .eq('status', 'active')
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        const briefTopic = activeBrief?.title || clientName;
        const briefContext = activeBrief?.problem_statement || client?.industry || 'General';
        const keywords = article.matched_keywords || [];

        // Get analysis (Groq or local fallback)
        const analysis = await getAnalysis(article, briefTopic, briefContext, keywords);

        // Determine tracking fields
        const analyzerUsed = analysis._method === 'groq' ? 'groq_llm' : 'local_fallback';
        const modelUsed = analysis._method === 'groq' ? (analysis._model || 'llama-3.3-70b-versatile') : 'rule_based_v1';

        // Detect if this is a content_item (YouTube, Reddit, etc.) vs a real article
        const isContentItem = article.content_type && article.content_type !== 'article';

        // Save to article_analysis (upsert to handle re-runs)
        // BUG FIX #2: Removed the dead `if (true) { ... } else { ... }` block.
        // The else branch was unreachable. We always write article_analysis because
        // content-saver writes all content types (videos, Reddit, PDFs) to `articles`.
        {
            const baseData = {
                article_id: article.id,
                summary: analysis.summary,
                sentiment: analysis.sentiment,
                importance_score: analysis.importance_score,
                importance_reason: analysis.importance_reason,
                narrative_frame: analysis.narrative_frame,
                entities: analysis.entities || { people: [], orgs: [], locations: [], figures: [] },
                claims: analysis.claims || [],
            };

            // Try with tracking columns first, fall back to without if they don't exist
            let analysisError;
            const { error: fullErr } = await supabase.from('article_analysis').upsert({
                ...baseData,
                analyzer_used: analyzerUsed,
                model_used: modelUsed,
            }, { onConflict: 'article_id' });

            if (fullErr && fullErr.message.includes('analyzer_used')) {
                // Columns don't exist yet — save without them
                const { error: fallbackErr } = await supabase.from('article_analysis').upsert(baseData, { onConflict: 'article_id' });
                analysisError = fallbackErr;
                log.ai.debug('[ANALYSIS] Tracking columns not in DB yet — saving without');
            } else {
                analysisError = fullErr;
            }

            if (analysisError) throw analysisError;
        }

        // Save entities to entity_mentions (filter out the client org name to avoid contamination)
        const entities = analysis.entities || {};
        const entityRows = [];
        const clientNameLower = clientName.toLowerCase();
        for (const [type, names] of Object.entries(entities)) {
            const entityType = type === 'people' ? 'person' : type === 'orgs' ? 'org' : type === 'locations' ? 'location' : 'figure';
            for (const name of (names || [])) {
                if (name && typeof name === 'string') {
                    // Skip the client org name — it contaminates the entity list
                    if (name.toLowerCase() === clientNameLower) continue;
                    entityRows.push({
                        article_id: article.id,
                        client_id: article.client_id,
                        entity_name: name,
                        entity_type: entityType,
                    });
                }
            }
        }

        if (entityRows.length > 0) {
            await supabase.from('entity_mentions').insert(entityRows);
        }

        // Generate embedding (non-blocking — if it fails, analysis still succeeds)
        try {
            await generateAndStoreEmbedding(article.id);
        } catch (embedErr) {
            log.ai.warn('Embedding skipped', { articleId: article.id, error: embedErr.message?.substring(0, 50) });
        }

        // Run watch expression matching (non-blocking)
        try {
            const { matchExpressions } = await import('./expression-matcher.js');
            const contentItem = { ...article, analysis };
            const { matched } = await matchExpressions(contentItem);
            if (matched.length > 0) {
                log.ai.info(`⚡ ${matched.length} watch expression(s) matched`, {
                    articleId: article.id,
                    labels: matched.map(m => m.label),
                });
            }
        } catch (weErr) {
            // Watch expressions table may not exist yet
            log.ai.debug('Watch expression matching skipped', { reason: weErr.message?.substring(0, 50) });
        }

        // Mark as complete + save English title if translated
        const articleUpdate = { analysis_status: 'complete' };
        if (analysis.title_en && analysis.title_en !== article.title) {
            articleUpdate.title_en = analysis.title_en;
        }
        await supabase
            .from('articles')
            .update(articleUpdate)
            .eq('id', article.id);

        // Also sync status to content_items (graceful)
        try {
            await supabase
                .from('content_items')
                .update({ analysis_status: 'complete' })
                .eq('id', article.id);
        } catch { /* content_items may not exist */ }

        analysisTotalSinceStartup++;
        log.ai.info(`Analysis complete (total since startup: ${analysisTotalSinceStartup}) via ${analyzerUsed} (${modelUsed})`, {
            title: (article.title || '').substring(0, 50),
            sentiment: analysis.sentiment,
            score: analysis.importance_score,
            claims: (analysis.claims || []).length,
        });

        return true;
    } catch (error) {
        log.ai.error('Analysis failed completely', { articleId: article.id, error: error.message });

        await supabase
            .from('articles')
            .update({ analysis_status: 'failed' })
            .eq('id', article.id);

        // Also sync failure to content_items (graceful)
        try {
            await supabase
                .from('content_items')
                .update({ analysis_status: 'failed' })
                .eq('id', article.id);
        } catch { /* content_items may not exist */ }

        return false;
    }
}

/**
 * Start the continuous analysis worker loop.
 */
export function startAnalysisWorker() {
    log.ai.info(`Analysis worker started (polling every ${POLL_INTERVAL_MS / 1000}s)`);

    async function poll() {
        try {
            // Poll articles table (primary)
            const { data: articles, error } = await supabase
                .from('articles')
                .select('id, client_id, title, content, url, published_at, matched_keywords, source_id')
                .eq('analysis_status', 'pending')
                .order('created_at', { ascending: true })
                .limit(BATCH_SIZE);

            if (error) {
                log.ai.error('Failed to fetch pending articles', { error: error.message });
                return;
            }

            if ((articles || []).length > 0) {
                log.ai.info('Analysis worker processing batch', {
                    count: articles.length,
                    oldestCreated: articles[0]?.created_at
                });
            }

            // Also poll content_items for non-article types that haven't been analyzed
            let contentItems = [];
            try {
                const { data: ciData } = await supabase
                    .from('content_items')
                    .select('id, client_id, title, content, url, published_at, matched_keywords, source_id, content_type')
                    .eq('analysis_status', 'pending')
                    .neq('content_type', 'article') // articles handled above
                    .order('created_at', { ascending: true })
                    .limit(BATCH_SIZE);
                contentItems = ciData || [];
            } catch (e) {
                // Only suppress "table doesn't exist" errors — log everything else
                if (!e.message?.includes('does not exist') && !e.message?.includes('relation')) {
                    log.ai.warn('content_items poll error (non-critical)', {
                        error: e.message?.substring(0, 100)
                    });
                }
            }

            const allPending = [...(articles || []), ...contentItems];
            if (allPending.length === 0) return;

            log.ai.info(`Processing ${allPending.length} pending items (${(articles || []).length} articles, ${contentItems.length} content_items)`);

            for (const item of allPending) {
                await analyzeArticle(item);
                await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_MS));
            }
        } catch (error) {
            log.ai.error('Worker poll error', { error: error.message });
        }
    }

    poll();
    setInterval(poll, POLL_INTERVAL_MS);
}
