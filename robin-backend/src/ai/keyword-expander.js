// ============================================================
// ROBIN OSINT — Auto Keyword Expander
// Priority 2: Discovers new keywords from collected articles.
//
// Weekly job fetches last 7 days of matched articles per client,
// sends them to Groq, and extracts new terms that are missing
// from the existing keyword list. Inserts as pending (approved=false)
// for admin review — one-click approve/reject in the briefs UI.
// ============================================================

import { groqChat } from '../lib/groq.js';
import { supabase } from '../lib/supabase.js';
import { log } from '../lib/logger.js';

const MAX_ARTICLES    = 40;  // max articles to send to LLM per expansion
const MAX_SUGGESTIONS = 20;  // max new keywords to suggest per run
const LOOKBACK_DAYS   = 7;   // how far back to look for articles

// Generic words we never want as keywords
const GENERIC_WORDS = new Set([
    'news', 'report', 'latest', 'update', 'article', 'story', 'press',
    'release', 'data', 'information', 'analysis', 'insight', 'trend',
    'company', 'market', 'business', 'industry', 'sector', 'global',
    'world', 'international', 'national', 'local', 'new', 'recent',
    'protest', 'fraud', 'corruption', 'crackdown', 'india', 'usa', 'uk',
    'sec', 'government', 'policy', 'law', 'lawsuit', 'investigation',
    'scandal', 'crisis', 'economy', 'growth', 'loss', 'profit',
]);

/**
 * Run keyword expansion for a single client brief.
 * Fetches recent articles, asks Groq for new keyword suggestions,
 * inserts pending suggestions into brief_generated_keywords.
 *
 * @param {string} clientId
 * @param {string} briefId   - Active brief ID
 * @param {string} clientName
 * @returns {Promise<{ suggested: number, inserted: number }>}
 */
export async function runKeywordExpansion(clientId, briefId, clientName) {
    log.ai.info('[KeywordExpander] Starting expansion', { clientId, briefId });

    // 1. Fetch recent matched articles for this client
    const since = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString();
    const { data: articles, error: artErr } = await supabase
        .from('articles')
        .select('title, content, matched_keywords')
        .eq('client_id', clientId)
        .gte('created_at', since)
        .not('matched_keywords', 'is', null)
        .order('created_at', { ascending: false })
        .limit(MAX_ARTICLES);

    if (artErr) throw new Error(`Failed to fetch articles: ${artErr.message}`);
    if (!articles || articles.length < 5) {
        log.ai.info('[KeywordExpander] Not enough articles for expansion', { clientId, count: articles?.length ?? 0 });
        return { suggested: 0, inserted: 0 };
    }

    // 2. Fetch existing keywords to avoid duplicates
    const { data: existingKws } = await supabase
        .from('brief_generated_keywords')
        .select('keyword')
        .eq('brief_id', briefId);

    const existingSet = new Set((existingKws || []).map(k => k.keyword.toLowerCase()));

    // 3. Call Groq for new keyword suggestions
    const suggestions = await expandKeywordsFromArticles(articles, existingSet, clientName);

    if (!suggestions.length) {
        log.ai.info('[KeywordExpander] No new suggestions from LLM', { clientId });
        return { suggested: 0, inserted: 0 };
    }

    // 4. Filter out generics, non-English, and existing keywords
    const NON_LATIN_RE = /[^\u0000-\u007F\u00C0-\u024F\u1E00-\u1EFF]/;
    const filtered = suggestions.filter(s => {
        const w = s.keyword?.toLowerCase().trim();
        if (!w || w.length < 3) return false;
        if (NON_LATIN_RE.test(w)) return false; // reject non-English script
        if (GENERIC_WORDS.has(w)) return false;
        if (existingSet.has(w)) return false;
        return true;
    }).slice(0, MAX_SUGGESTIONS);

    if (!filtered.length) {
        log.ai.info('[KeywordExpander] All suggestions filtered out', { clientId });
        return { suggested: suggestions.length, inserted: 0 };
    }

    // 5. Insert as pending (approved=false, rejected=false)
    const rows = filtered.map(s => ({
        brief_id:  briefId,
        keyword:   s.keyword.toLowerCase().trim(),
        category:  s.category || 'auto_discovered',
        priority:  4,  // lower than human-curated
        rationale: s.rationale || 'Auto-discovered from recent articles',
        approved:  false,
        rejected:  false,
    }));

    const { error: insErr } = await supabase
        .from('brief_generated_keywords')
        .upsert(rows, { onConflict: 'brief_id,keyword', ignoreDuplicates: true });

    if (insErr) {
        log.ai.warn('[KeywordExpander] Insert failed', { clientId, error: insErr.message });
        return { suggested: suggestions.length, inserted: 0 };
    }

    log.ai.info('[KeywordExpander] Expansion complete', {
        clientId, articles: articles.length,
        suggested: suggestions.length, inserted: filtered.length,
    });

    return { suggested: suggestions.length, inserted: filtered.length };
}

/**
 * Run keyword expansion for ALL clients with active briefs.
 * Called by weekly cron job.
 */
export async function runKeywordExpansionForAllClients() {
    log.ai.info('[KeywordExpander] Weekly expansion run starting');

    const { data: activeBriefs, error } = await supabase
        .from('client_briefs')
        .select('id, client_id, clients(name)')
        .eq('status', 'active');

    if (error || !activeBriefs?.length) {
        log.ai.info('[KeywordExpander] No active briefs found');
        return;
    }

    let totalInserted = 0;
    for (const brief of activeBriefs) {
        try {
            const clientName = brief.clients?.name || 'Unknown';
            const result = await runKeywordExpansion(brief.client_id, brief.id, clientName);
            totalInserted += result.inserted;
            // Rate limit between clients
            await new Promise(r => setTimeout(r, 2000));
        } catch (err) {
            log.ai.warn('[KeywordExpander] Client expansion failed', {
                briefId: brief.id, error: err.message,
            });
        }
    }

    log.ai.info('[KeywordExpander] Weekly expansion complete', { totalInserted });
}

/**
 * Ask Groq to extract new keyword suggestions from a batch of articles.
 */
async function expandKeywordsFromArticles(articles, existingSet, clientName) {
    // Build compact article list for the prompt
    const articleLines = articles.slice(0, MAX_ARTICLES).map((a, i) => {
        const snippet = (a.content || '').substring(0, 200).replace(/\s+/g, ' ');
        return `${i + 1}. ${a.title} — ${snippet}`;
    }).join('\n');

    const existingList = [...existingSet].slice(0, 80).join(', ');

    const prompt = `You are an intelligence analyst helping monitor news for "${clientName}".

Below are recent news articles already collected. Your task is to discover NEW keywords that appear frequently in these articles but are NOT yet being tracked.

EXISTING KEYWORDS (do NOT suggest these):
${existingList}

RECENT ARTICLES:
${articleLines}

Extract 15-20 NEW specific keywords or short phrases that:
- Are in ENGLISH ONLY — no Hindi, Odia, or any non-Latin script. Use English transliterations as they appear in English-language media.
- Appear in multiple articles above
- Are NOT in the existing keywords list
- Are specific: names of people, places, organizations, schemes, laws, or events
- Are 1-3 words maximum
- Would help catch future articles on the same topics

Return ONLY a valid JSON array, no explanation:
[
  {"keyword": "exact phrase", "category": "core_entity|geographic|stakeholder|regulatory_legal|sentiment|narrative|industry_sector|competitor_peer|abstract_lateral|proxy_indicator", "rationale": "why this matters in 1 sentence"},
  ...
]`;

    try {
        const response = await groqChat(
            [{ role: 'user', content: prompt }],
            { temperature: 0.3, max_tokens: 1500, response_format: { type: 'json_array' } }
        );

        const content = response.choices[0]?.message?.content?.trim() || '[]';
        const parsed = JSON.parse(content);
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        // Groq may not support json_array — retry without response_format
        try {
            const response = await groqChat(
                [{ role: 'user', content: prompt }],
                { temperature: 0.3, max_tokens: 1500 }
            );
            const content = response.choices[0]?.message?.content?.trim() || '[]';
            // Extract JSON array from response
            const match = content.match(/\[[\s\S]*\]/);
            if (match) return JSON.parse(match[0]);
        } catch { /* fall through */ }

        log.ai.warn('[KeywordExpander] LLM call failed', { error: err.message });
        return [];
    }
}
