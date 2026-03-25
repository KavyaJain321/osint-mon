// ============================================================
// ROBIN OSINT — Semantic Keyword Clusterer
// Priority 5: Groups existing keywords into semantic clusters
// using Groq LLM. No embeddings / pgvector required.
//
// Clusters are stored in brief_generated_keywords.cluster_group
// so they persist and can be displayed in the briefs UI.
// Run manually via POST /api/keywords/cluster or weekly after
// keyword expansion.
// ============================================================

import { groqChat } from '../lib/groq.js';
import { supabase } from '../lib/supabase.js';
import { log } from '../lib/logger.js';

const MAX_KW_PER_CALL = 150; // max keywords to send per LLM call

/**
 * Run semantic clustering for a single client brief.
 * Groups all keywords into 5-10 named semantic clusters and
 * writes cluster_group back to the DB.
 *
 * @param {string} briefId
 * @param {string} clientName
 * @returns {Promise<{ clusters: number, keywords: number }>}
 */
export async function runKeywordClustering(briefId, clientName) {
    log.ai.info('[Clusterer] Starting semantic clustering', { briefId });

    // 1. Fetch all approved (or all) keywords for this brief
    const { data: keywords, error } = await supabase
        .from('brief_generated_keywords')
        .select('id, keyword, category')
        .eq('brief_id', briefId)
        .limit(300);

    if (error) throw new Error(`Failed to fetch keywords: ${error.message}`);
    if (!keywords || keywords.length < 5) {
        log.ai.info('[Clusterer] Not enough keywords to cluster', { briefId, count: keywords?.length ?? 0 });
        return { clusters: 0, keywords: 0 };
    }

    // 2. Call LLM to assign cluster labels (batch if needed)
    const assignments = await clusterKeywordsWithLLM(keywords.slice(0, MAX_KW_PER_CALL), clientName);

    if (!assignments || Object.keys(assignments).length === 0) {
        log.ai.warn('[Clusterer] LLM returned no cluster assignments', { briefId });
        return { clusters: 0, keywords: 0 };
    }

    // 3. Write cluster_group back to DB in batches
    const clusterNames = new Set();
    let updated = 0;

    const updates = keywords
        .filter(kw => assignments[kw.id] || assignments[kw.keyword])
        .map(kw => ({
            id: kw.id,
            cluster_group: assignments[kw.id] || assignments[kw.keyword] || null,
        }));

    for (const row of updates) {
        if (!row.cluster_group) continue;
        clusterNames.add(row.cluster_group);
        const { error: upErr } = await supabase
            .from('brief_generated_keywords')
            .update({ cluster_group: row.cluster_group })
            .eq('id', row.id);
        if (!upErr) updated++;
    }

    log.ai.info('[Clusterer] Clustering complete', {
        briefId,
        clusters: clusterNames.size,
        keywordsUpdated: updated,
    });

    return { clusters: clusterNames.size, keywords: updated };
}

/**
 * Run clustering for ALL clients with active briefs.
 * Called after weekly keyword expansion.
 */
export async function runClusteringForAllClients() {
    log.ai.info('[Clusterer] Starting weekly clustering run');

    const { data: activeBriefs, error } = await supabase
        .from('client_briefs')
        .select('id, client_id, clients(name)')
        .eq('status', 'active');

    if (error || !activeBriefs?.length) {
        log.ai.info('[Clusterer] No active briefs found');
        return;
    }

    for (const brief of activeBriefs) {
        try {
            const clientName = brief.clients?.name || 'Unknown';
            await runKeywordClustering(brief.id, clientName);
            await new Promise(r => setTimeout(r, 2000));
        } catch (err) {
            log.ai.warn('[Clusterer] Client clustering failed', { briefId: brief.id, error: err.message });
        }
    }

    log.ai.info('[Clusterer] Weekly clustering run complete');
}

/**
 * Ask Groq to assign cluster labels to a list of keywords.
 * Returns an object mapping keyword id (or keyword text) → cluster name.
 */
async function clusterKeywordsWithLLM(keywords, clientName) {
    const kwList = keywords.map((k, i) => `${i + 1}. [${k.id}] "${k.keyword}" (${k.category})`).join('\n');

    const prompt = `You are an intelligence analyst organising a keyword monitoring list for "${clientName}".

Below is a list of keywords in format: N. [id] "keyword" (category)

${kwList}

Group these keywords into 5-10 meaningful semantic clusters. Each cluster should have a SHORT descriptive name (2-4 words) that describes what the keywords in it have in common.

Rules:
- Every keyword must be assigned to exactly one cluster
- Cluster names MUST be in English only
- Cluster names should be specific to "${clientName}" context (e.g. "Corruption & Fraud", "Land & Mining", "Political Leadership", "Police & Law Enforcement")
- DO NOT use generic names like "Cluster 1", "Group A", "Miscellaneous"
- Aim for 8-20 keywords per cluster

Return ONLY a valid JSON object mapping keyword id → cluster name:
{
  "uuid-here": "Cluster Name",
  "uuid-here": "Another Cluster Name",
  ...
}`;

    try {
        const response = await groqChat(
            [{ role: 'user', content: prompt }],
            { temperature: 0.2, max_tokens: 4000, response_format: { type: 'json_object' } }
        );
        const content = response.choices[0]?.message?.content?.trim() || '{}';
        const parsed = JSON.parse(content);
        return typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (err) {
        // Retry without response_format
        try {
            const response = await groqChat(
                [{ role: 'user', content: prompt }],
                { temperature: 0.2, max_tokens: 4000 }
            );
            const content = response.choices[0]?.message?.content?.trim() || '{}';
            const match = content.match(/\{[\s\S]*\}/);
            if (match) return JSON.parse(match[0]);
        } catch { /* fall through */ }

        log.ai.warn('[Clusterer] LLM call failed', { error: err.message });
        return {};
    }
}
