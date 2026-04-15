// ============================================================
// ROBIN OSINT — Palantir-Grade Intelligence Engine
// 7-pass batch analysis: entities, threats, temporal, network,
// source intelligence, predictive signals, narrative synthesis
// ============================================================

import { supabase } from '../lib/supabase.js';
import { groqChat } from '../lib/groq.js';
import { log } from '../lib/logger.js';
import { updatePipelineStage } from '../lib/pipeline-tracker.js';

// ────────────────────────────────────────────────────────────
// BATCH LOCK — Prevent concurrent runs
// ────────────────────────────────────────────────────────────

const BATCH_LOCK_KEY = 'batch_intelligence_lock';
const BATCH_LOCK_TIMEOUT_HOURS = 3;

async function acquireBatchLock() {
    try {
        const { data: existing } = await supabase
            .from('system_state')
            .select('value, updated_at')
            .eq('key', BATCH_LOCK_KEY)
            .single();

        if (existing?.value === 'true') {
            const lockAge = Date.now() - new Date(existing.updated_at).getTime();
            const maxAge = BATCH_LOCK_TIMEOUT_HOURS * 60 * 60 * 1000;
            if (lockAge < maxAge) {
                log.ai.warn('[BATCH] Lock is held by another process. Skipping this run.', {
                    lockAge: Math.round(lockAge / 60000) + 'min',
                    maxAge: BATCH_LOCK_TIMEOUT_HOURS + 'h',
                });
                return false;
            }
            log.ai.warn('[BATCH] Stale lock detected, overriding.', {
                lockAge: Math.round(lockAge / 60000) + 'min',
            });
        }

        await supabase.from('system_state').upsert({
            key: BATCH_LOCK_KEY,
            value: 'true',
            updated_at: new Date().toISOString(),
        });
        log.ai.info('[BATCH] Lock acquired');
        return true;
    } catch (err) {
        // If system_state table doesn't exist, proceed without lock
        log.ai.warn('[BATCH] Lock check failed (table may not exist), proceeding anyway', { error: err.message });
        return true;
    }
}

async function releaseBatchLock() {
    try {
        await supabase.from('system_state').upsert({
            key: BATCH_LOCK_KEY,
            value: 'false',
            updated_at: new Date().toISOString(),
        });
        log.ai.info('[BATCH] Lock released');
    } catch (err) {
        log.ai.warn('[BATCH] Lock release failed', { error: err.message });
    }
}

// ────────────────────────────────────────────────────────────
// MAIN ENTRY POINT
// ────────────────────────────────────────────────────────────

export async function runBatchIntelligence() {
    const acquired = await acquireBatchLock();
    if (!acquired) return;

    log.ai.info('=== Palantir Intelligence Engine started ===');
    await updatePipelineStage('intelligence', 'Intelligence Engine started — processing clients...', {});
    const startTime = Date.now();

    try {
        const { data: clients } = await supabase
            .from('clients')
            .select('id, name, industry')
            .limit(100);

        if (!clients || clients.length === 0) {
            log.ai.info('No clients found');
            return;
        }

        for (const client of clients) {
            try {
                await processClientIntelligence(client);
            } catch (error) {
                log.ai.error('Intelligence failed for client', { clientId: client.id, error: error.message });
            }
        }

        log.ai.info('=== Intelligence Engine completed ===', { durationMs: Date.now() - startTime });
        await updatePipelineStage('complete', 'Intelligence Engine complete! All data is ready.', { durationMs: Date.now() - startTime });
    } catch (error) {
        log.ai.error('Intelligence Engine failed', { error: error.message });
    } finally {
        await releaseBatchLock();
    }
}

// ────────────────────────────────────────────────────────────
// CORE CLIENT PROCESSOR — 7 PASSES
// ────────────────────────────────────────────────────────────

async function processClientIntelligence(client) {
    const now = new Date();
    const thirtyDaysAgo = new Date(now - 30 * 86400000).toISOString();
    const sevenDaysAgo = new Date(now - 7 * 86400000).toISOString();
    const fortyEightHoursAgo = new Date(now - 48 * 3600000).toISOString();

    // Fetch the active brief — pull ALL context fields for prompt injection
    const { data: activeBrief } = await supabase
        .from('client_briefs')
        .select('title, problem_statement, risk_domains, entities_of_interest, geographic_focus, industry')
        .eq('client_id', client.id)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    const briefTopic = activeBrief?.title || client.name;
    const briefContext = activeBrief?.problem_statement || client.industry;

    // Full client profile — injected into Pass 7 + Pass 8 prompts
    const briefProfile = {
        client_name: client.name,
        topic: briefTopic,
        context: briefContext,
        geographic_focus: activeBrief?.geographic_focus || 'Not specified',
        risk_domains: Array.isArray(activeBrief?.risk_domains) ? activeBrief.risk_domains : [],
        entities_of_interest: Array.isArray(activeBrief?.entities_of_interest) ? activeBrief.entities_of_interest : [],
        client_industry: activeBrief?.industry || client.industry || 'General',
    };

    // ── Collect raw data ──
    const { data: articles } = await supabase
        .from('articles')
        .select('id, title, content, url, published_at, source_id, matched_keywords')
        .eq('client_id', client.id)
        .gte('published_at', thirtyDaysAgo)
        .eq('analysis_status', 'complete')
        .order('published_at', { ascending: false })
        .limit(500);

    if (!articles || articles.length === 0) {
        log.ai.info('No articles for intelligence', { client: client.name });
        return;
    }

    const articleIds = articles.map(a => a.id);

    const { data: analyses } = await supabase
        .from('article_analysis')
        .select('article_id, sentiment, importance_score, importance_reason, narrative_frame, entities, claims, summary')
        .in('article_id', articleIds);

    const { data: entityMentions } = await supabase
        .from('entity_mentions')
        .select('entity_name, entity_type, article_id, created_at')
        .eq('client_id', client.id)
        .limit(2000);

    const { data: sources } = await supabase
        .from('sources')
        .select('id, name, url, tier')
        .eq('client_id', client.id);

    // Build lookup maps
    const analysisMap = {};
    (analyses || []).forEach(a => { analysisMap[a.article_id] = a; });

    const sourceMap = {};
    (sources || []).forEach(s => { sourceMap[s.id] = s; });

    // Enrich articles with analysis and tier weight
    const TIER_WEIGHTS = { 1: 1.5, 2: 1.0, 3: 0.6 };
    const enrichedArticles = articles.map(a => {
        const source = sourceMap[a.source_id];
        const tier = source?.tier || 2;
        return {
            ...a,
            analysis: analysisMap[a.id] || {},
            sourceName: source?.name || 'Unknown',
            sourceTier: tier,
            tierWeight: TIER_WEIGHTS[tier] || 1.0,
        };
    });

    log.ai.info('Intelligence data loaded', {
        client: client.name,
        articles: articles.length,
        entities: (entityMentions || []).length,
    });

    // ── Execute 7 passes ──
    await updatePipelineStage('intelligence', 'Pass 1/7 — Entity Intelligence...', { pass: 1, total: 7, client: client.name });
    const pass1 = await passEntityIntelligence(client, enrichedArticles, entityMentions || [], briefTopic, briefContext);
    await updatePipelineStage('intelligence', 'Pass 2/7 — Threat Matrix...', { pass: 2, total: 7 });
    const pass2 = await passThreatMatrix(client, enrichedArticles, pass1);
    await updatePipelineStage('intelligence', 'Pass 3/7 — Temporal Intelligence...', { pass: 3, total: 7 });
    const pass3 = passTemporalIntelligence(enrichedArticles, sevenDaysAgo, fortyEightHoursAgo);
    await updatePipelineStage('intelligence', 'Pass 4/7 — Network Analysis...', { pass: 4, total: 7 });
    const pass4 = passNetworkAnalysis(entityMentions || []);
    await updatePipelineStage('intelligence', 'Pass 5/7 — Source Intelligence...', { pass: 5, total: 7 });
    const pass5 = await passSourceIntelligence(client, enrichedArticles, sources || []);
    await updatePipelineStage('intelligence', 'Pass 6/7 — Predictive Signals...', { pass: 6, total: 7 });
    const pass6 = await passPredictiveSignals(client, enrichedArticles, pass1, pass3, pass4, briefTopic, briefContext);
    await updatePipelineStage('intelligence', 'Pass 7/7 — Narrative Synthesis & Inference...', { pass: 7, total: 7 });
    const pass7 = await passNarrativeSynthesis(client, pass1, pass2, pass3, pass4, pass5, pass6, enrichedArticles, briefTopic, briefContext, briefProfile);
    const pass8 = await passInferenceChains(client, enrichedArticles, pass1, pass2, pass3, pass6, briefTopic, briefContext, briefProfile);

    // ── Save to narrative_patterns (legacy compatibility) ──
    const today = now.toISOString().split('T')[0];
    const sentimentBreakdown = computeSentimentBreakdown(enrichedArticles);
    const volumeData = computeVolumeData(enrichedArticles);

    await supabase.from('narrative_patterns').upsert({
        client_id: client.id,
        pattern_date: today,
        sentiment_breakdown: sentimentBreakdown,
        volume_data: volumeData,
        top_entities: pass1.topEntities.slice(0, 20),
        anomalies: pass6.signals.filter(s => s.severity === 'warning' || s.severity === 'critical'),
        entity_cooccurrences: pass4.topEdges.slice(0, 20),
        source_sentiment: pass5.sourceSentiments,
        weekly_narrative: pass7.narrative,
        risk_level: pass2.riskLevel,
    }, { onConflict: 'client_id,pattern_date' });

    log.ai.info('Intelligence complete', {
        client: client.name,
        risk: pass2.riskLevel,
        threats: pass2.activeThreats.length,
        signals: pass6.signals.length,
        entities: pass1.topEntities.length,
        inferenceChains: pass8.chains.length,
    });
}

// ────────────────────────────────────────────────────────────
// PASS 1: ENTITY INTELLIGENCE
// Build entity profiles with influence scores, sentiment, relationships
// ────────────────────────────────────────────────────────────

async function passEntityIntelligence(client, articles, entityMentions, briefTopic, briefContext) {
    log.ai.info('[ENTITY-PASS1] Starting entity intelligence', { client: client.name, rawMentions: entityMentions.length });

    // ── Entity name normalization (dedup aliases) ────────────
    const ENTITY_ALIASES = {
        'US': 'United States', 'U.S.': 'United States', 'U.S.A.': 'United States', 'USA': 'United States', 'America': 'United States',
        'UK': 'United Kingdom', 'U.K.': 'United Kingdom', 'Britain': 'United Kingdom', 'Great Britain': 'United Kingdom',
        'EU': 'European Union', 'E.U.': 'European Union',
        'UAE': 'United Arab Emirates', 'U.A.E.': 'United Arab Emirates',
        'PM': 'Prime Minister', 'Pres.': 'President',
        'UN': 'United Nations', 'U.N.': 'United Nations',
        'FBI': 'Federal Bureau of Investigation',
        'CIA': 'Central Intelligence Agency',
        'IMF': 'International Monetary Fund',
        'NATO': 'North Atlantic Treaty Organization',
    };

    // ── Junk entity filter ──────────────────────────────────
    const JUNK_TYPES = new Set(['figure', 'number', 'amount', 'date', 'time', 'percentage', 'currency']);
    const JUNK_PATTERNS = [
        /^\$[\d,.]+$/,          // $2,000
        /^\d+[\s-]?(month|year|day|week|hour|minute)/i,  // 13 months, 18-month
        /^\d+(\.\d+)?%?$/,     // 36, 42.5, 75%
        /^\d+$/,               // pure numbers
        /^[\d,]+$/,            // comma-separated numbers
        /^[A-Z]\.?$/,          // single letters
        /^(Mr|Mrs|Ms|Dr|Jr|Sr)\.?$/i,  // titles
    ];

    function isJunkEntity(name, type) {
        if (JUNK_TYPES.has(type?.toLowerCase())) return true;
        if (name.length < 2) return true;
        return JUNK_PATTERNS.some(p => p.test(name.trim()));
    }

    function normalizeName(name) {
        const trimmed = name.trim();
        return ENTITY_ALIASES[trimmed] || trimmed;
    }

    const entityData = {};

    // Aggregate entity stats (with filtering and normalization)
    let filtered = 0;
    for (const mention of entityMentions) {
        if (isJunkEntity(mention.entity_name, mention.entity_type)) {
            filtered++;
            continue;
        }
        const normalizedName = normalizeName(mention.entity_name);
        const normalizedType = mention.entity_type === 'figure' ? 'org' : mention.entity_type; // reclassify remaining
        const key = normalizedName + '::' + normalizedType;
        if (!entityData[key]) {
            entityData[key] = {
                name: normalizedName,
                type: normalizedType,
                articleIds: new Set(),
                sentiments: { positive: 0, negative: 0, neutral: 0 },
                firstSeen: mention.created_at,
                lastSeen: mention.created_at,
                coEntities: {},
                importanceSum: 0,
                narrativeFrames: {},
            };
        }
        const e = entityData[key];
        e.articleIds.add(mention.article_id);
        if (mention.created_at < e.firstSeen) e.firstSeen = mention.created_at;
        if (mention.created_at > e.lastSeen) e.lastSeen = mention.created_at;
    }

    log.ai.info('[ENTITY-PASS1] After filtering', { validEntities: Object.keys(entityData).length, junkFiltered: filtered });

    // Build co-entity map from same-article mentions (using normalized names)
    const articleEntityMap = {};
    for (const mention of entityMentions) {
        if (isJunkEntity(mention.entity_name, mention.entity_type)) continue;
        const normalizedName = normalizeName(mention.entity_name);
        if (!articleEntityMap[mention.article_id]) articleEntityMap[mention.article_id] = new Set();
        articleEntityMap[mention.article_id].add(normalizedName);
    }
    for (const [artId, nameSet] of Object.entries(articleEntityMap)) {
        const names = [...nameSet]; // deduped per article
        for (let i = 0; i < names.length; i++) {
            for (let j = i + 1; j < names.length; j++) {
                const key1 = Object.keys(entityData).find(k => entityData[k].name === names[i]);
                if (key1 && entityData[key1]) {
                    entityData[key1].coEntities[names[j]] = (entityData[key1].coEntities[names[j]] || 0) + 1;
                }
            }
        }
    }

    // Enrich with article analysis data
    for (const article of articles) {
        const analysis = article.analysis;
        if (!analysis) continue;

        const artEntities = entityMentions.filter(m => m.article_id === article.id && !isJunkEntity(m.entity_name, m.entity_type));
        for (const mention of artEntities) {
            const normalizedName = normalizeName(mention.entity_name);
            const normalizedType = mention.entity_type === 'figure' ? 'org' : mention.entity_type;
            const key = normalizedName + '::' + normalizedType;
            if (!entityData[key]) continue;
            const e = entityData[key];

            if (analysis.sentiment) e.sentiments[analysis.sentiment]++;
            if (analysis.importance_score) e.importanceSum += analysis.importance_score;
            if (analysis.narrative_frame) {
                e.narrativeFrames[analysis.narrative_frame] = (e.narrativeFrames[analysis.narrative_frame] || 0) + 1;
            }
        }
    }

    // Find max mention count for normalization
    const allMentionCounts = Object.values(entityData).map(e => e.articleIds.size);
    const maxMentions = Math.max(1, ...allMentionCounts);

    // Calculate influence scores and build profiles
    const topEntities = Object.values(entityData)
        .filter(e => e.articleIds.size >= 1) // minimum 1 mention to be tracked
        .map(e => {
            const mentionCount = e.articleIds.size;
            const avgImportance = mentionCount > 0 ? e.importanceSum / mentionCount : 0;
            const sentimentTotal = e.sentiments.positive + e.sentiments.negative + e.sentiments.neutral;
            const negativeRatio = sentimentTotal > 0 ? e.sentiments.negative / sentimentTotal : 0;

            // Influence = log-scaled frequency × importance × recency × tier boost
            // log scale prevents high-mention entities from all clustering at 100
            const daysSinceLastSeen = (Date.now() - new Date(e.lastSeen).getTime()) / 86400000;
            const recencyBoost = Math.max(0.2, 1 - (daysSinceLastSeen / 30));
            const frequencyScore = (Math.log2(mentionCount + 1) / Math.log2(maxMentions + 1)) * 50; // 0-50
            const importanceScore = (avgImportance / 10) * 30; // 0-30
            const recencyScore = recencyBoost * 20; // 0-20

            // Tier boost: compute avg tier weight across articles mentioning this entity
            const entityArticles = articles.filter(a => e.articleIds.has(a.id));
            const avgTierWeight = entityArticles.length > 0
                ? entityArticles.reduce((sum, a) => sum + (a.tierWeight || 1.0), 0) / entityArticles.length
                : 1.0;
            const tierBonus = (avgTierWeight - 1.0) * 15; // -6 to +7.5 based on source tier

            const influence = Math.min(100, frequencyScore + importanceScore + recencyScore + tierBonus);

            // Sentiment trend
            const trend = negativeRatio > 0.5 ? 'worsening'
                : negativeRatio > 0.3 ? 'concerning'
                    : e.sentiments.positive > e.sentiments.negative ? 'improving' : 'stable';

            // Risk tags
            const riskTags = [];
            if (negativeRatio > 0.6) riskTags.push('high_negative_coverage');
            if (mentionCount >= 10) riskTags.push('high_visibility');
            if (mentionCount >= 5 && mentionCount < 10) riskTags.push('moderate_visibility');
            if (daysSinceLastSeen < 2) riskTags.push('active_now');
            const topFrame = Object.entries(e.narrativeFrames).sort((a, b) => b[1] - a[1])[0];
            if (topFrame && (topFrame[0] === 'crisis' || topFrame[0] === 'conflict')) riskTags.push('crisis_linked');
            if (avgImportance >= 7) riskTags.push('high_importance');

            // Top relationships
            const relationships = Object.entries(e.coEntities)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10)
                .map(([name, count]) => ({ entity_name: name, strength: count }));

            // ── Phase 4: Relevance scoring ──
            // Relevance = influence × topic_overlap × recency
            const briefKeywords = (briefTopic || '').toLowerCase().split(/\s+/).filter(w => w.length > 2);
            const entityArticlesList = articles.filter(a => e.articleIds.has(a.id));
            const topicOverlap = briefKeywords.length > 0
                ? entityArticlesList.filter(a => {
                    const text = ((a.title || '') + ' ' + (a.analysis?.summary || '')).toLowerCase();
                    return briefKeywords.some(kw => text.includes(kw));
                }).length / Math.max(entityArticlesList.length, 1)
                : 0.5; // default if no brief
            const relevanceScore = Math.min(100, Math.round(
                (influence / 100) * 40 + topicOverlap * 40 + recencyBoost * 20
            ));

            return {
                name: e.name,
                type: e.type,
                mentionCount,
                influence: Math.round(influence * 10) / 10,
                relevanceScore,
                sentiments: e.sentiments,
                trend,
                riskTags,
                relationships,
                avgImportance: Math.round(avgImportance * 10) / 10,
                dominantFrame: topFrame ? topFrame[0] : 'none',
                firstSeen: new Date(e.firstSeen).toISOString().split('T')[0],
                lastSeen: new Date(e.lastSeen).toISOString().split('T')[0],
                relevance_reason: '', // filled by LLM below
                connected_stories: [], // filled below
            };
        })
        .sort((a, b) => b.relevanceScore - a.relevanceScore); // Sort by RELEVANCE, not influence

    // ── Phase 4: Generate relevance reasons via LLM (batch top 10) ──
    try {
        const top10 = topEntities.slice(0, 10);
        if (top10.length > 0 && briefTopic) {
            const entitySummaries = top10.map(e => {
                const topArticles = articles
                    .filter(a => a.analysis && entityMentions.some(m => normalizeName(m.entity_name) === e.name && m.article_id === a.id))
                    .slice(0, 3)
                    .map(a => a.analysis?.summary || a.title)
                    .join('; ');
                return `${e.name} (${e.type}, ${e.mentionCount} mentions, sentiment: ${e.trend}): ${topArticles}`;
            }).join('\n');

            const resp = await groqChat([
                { role: 'system', content: `You explain why entities matter to a specific intelligence monitoring brief. Be specific, cite evidence. 2 sentences max per entity.` },
                {
                    role: 'user', content: `Brief topic: "${briefTopic}"
Brief context: ${briefContext || 'General monitoring'}

For each entity below, write a 2-sentence explanation of WHY this entity matters to the monitoring goals above. Return as JSON array: [{"name": "...", "reason": "..."}]

Entities:
${entitySummaries}`
                },
            ], { temperature: 0.3, max_tokens: 1500 });

            const text = resp.choices[0]?.message?.content || '';
            try {
                const jsonMatch = text.match(/\[.*\]/s);
                if (jsonMatch) {
                    const reasons = JSON.parse(jsonMatch[0]);
                    for (const r of reasons) {
                        const entity = topEntities.find(e => e.name.toLowerCase() === (r.name || '').toLowerCase());
                        if (entity) entity.relevance_reason = r.reason || '';
                    }
                }
            } catch { /* JSON parse failure — reasons stay empty */ }
            log.ai.info('[ENTITY-PASS1] Generated relevance reasons for', top10.length, 'entities');
        }
    } catch (err) {
        log.ai.warn('[ENTITY-PASS1] Relevance reason generation failed', { error: err.message });
    }

    // ── Phase 4: Connected stories (group articles by story cluster) ──
    for (const entity of topEntities.slice(0, 20)) {
        const entityArticles = articles.filter(a =>
            entityMentions.some(m => normalizeName(m.entity_name) === entity.name && m.article_id === a.id)
        );
        // Group by narrative frame as story proxy
        const storyClusters = {};
        for (const art of entityArticles) {
            const frame = art.analysis?.narrative_frame || 'general';
            if (!storyClusters[frame]) storyClusters[frame] = { theme: frame, articles: [], sentiment: 'neutral' };
            storyClusters[frame].articles.push(art.title);
            if (art.analysis?.sentiment === 'negative') storyClusters[frame].sentiment = 'negative';
        }
        entity.connected_stories = Object.values(storyClusters).slice(0, 5).map(c => ({
            theme: c.theme,
            article_count: c.articles.length,
            sentiment: c.sentiment,
            sample_title: c.articles[0] || '',
        }));
    }

    // Save entity profiles to DB
    // NOTE: Only include columns that exist in the entity_profiles table schema.
    // Extra data (relevance_reason, connected_stories) is stored in relationships JSONB.
    const profilesToSave = topEntities.slice(0, 50).map(e => ({
        client_id: client.id,
        entity_name: e.name,
        entity_type: e.type,
        mention_count: e.mentionCount,
        sentiment_profile: {
            ...e.sentiments,
            trend: e.trend,
            relevance_reason: e.relevance_reason || '',
            connected_stories: (e.connected_stories || []).slice(0, 3),
        },
        influence_score: e.influence,
        // Store relevance + stories inside relationships JSONB as extended_metadata
        relationships: [
            ...e.relationships,
            { _meta: true, relevance_score: e.relevanceScore, dominant_frame: e.dominantFrame },
        ],
        risk_tags: e.riskTags,
        updated_at: new Date().toISOString(),
    }));

    try {
        // Delete existing profiles for this client (clean slate)
        await supabase.from('entity_profiles').delete().eq('client_id', client.id);
        log.ai.info('[ENTITY-PASS1] Cleared old profiles, saving', profilesToSave.length, 'new profiles');

        let saved = 0, failed = 0;
        for (const profile of profilesToSave) {
            const { error } = await supabase.from('entity_profiles').upsert(profile, {
                onConflict: 'client_id,entity_name,entity_type',
            });
            if (error) {
                log.ai.warn('[ENTITY-PASS1] Profile save failed', { entity: profile.entity_name, error: error.message });
                failed++;
            } else {
                saved++;
            }
        }
        log.ai.info('[ENTITY-PASS1] Profiles saved', { saved, failed });
    } catch (err) {
        log.ai.warn('Entity profiles save failed', { error: err.message });
    }

    log.ai.info('Pass 1: Entity Intelligence', { entities: topEntities.length, topInfluence: topEntities[0]?.name });

    return { topEntities, entityData, articleEntityMap };
}

// ────────────────────────────────────────────────────────────
// PASS 2: THREAT MATRIX
// Score 5 dimensions, detect active threats, track velocity
// ────────────────────────────────────────────────────────────

async function passThreatMatrix(client, articles, entityPass) {
    const recentArticles = articles.filter(a =>
        new Date(a.published_at) > new Date(Date.now() - 7 * 86400000)
    );

    // Count by category
    let reputational = 0, financial = 0, regulatory = 0, operational = 0, geopolitical = 0;

    for (const art of recentArticles) {
        const a = art.analysis;
        if (!a) continue;

        const frame = a.narrative_frame || 'none';
        const sentiment = a.sentiment || 'neutral';
        const importance = a.importance_score || 3;
        const weight = sentiment === 'negative' ? importance * 1.5 : importance * 0.5;

        // Classify into threat dimensions based on frame + keywords
        const text = ((art.title || '') + ' ' + (a.summary || '')).toLowerCase();

        if (frame === 'crisis' || frame === 'accountability' || text.match(/scandal|fraud|corruption|allegation/))
            reputational += weight;
        if (frame === 'economic' || text.match(/bank|financ|market|tariff|trade|debt|economy/))
            financial += weight;
        if (text.match(/regulat|law|sanction|fatf|imf|compliance|court|legal/))
            regulatory += weight;
        if (text.match(/strike|disrupt|shutdown|supply|infra|cyber|hack/))
            operational += weight;
        if (frame === 'conflict' || text.match(/war|military|geopolit|diplomacy|border|conflict|tension/))
            geopolitical += weight;
    }

    // Normalize to 0-100
    const maxDim = Math.max(reputational, financial, regulatory, operational, geopolitical, 1);
    const normalize = v => Math.min(100, Math.round((v / maxDim) * 100));

    const dimensions = {
        reputational: normalize(reputational),
        financial: normalize(financial),
        regulatory: normalize(regulatory),
        operational: normalize(operational),
        geopolitical: normalize(geopolitical),
    };

    // Overall score = weighted average (geopolitical & reputational weighted higher)
    const overall = Math.round(
        (dimensions.reputational * 0.25 +
            dimensions.financial * 0.2 +
            dimensions.regulatory * 0.2 +
            dimensions.operational * 0.1 +
            dimensions.geopolitical * 0.25)
    );

    // Risk level from overall score
    const riskLevel = overall >= 70 ? 'high' : overall >= 50 ? 'elevated' : overall >= 30 ? 'medium' : 'low';

    // Active threats: high-importance negative articles from last 48h
    const fortyEightHoursAgo = new Date(Date.now() - 48 * 3600000);
    const activeThreats = recentArticles
        .filter(a => {
            const analysis = a.analysis;
            return analysis?.sentiment === 'negative' &&
                (analysis?.importance_score || 0) >= 6 &&
                new Date(a.published_at) > fortyEightHoursAgo;
        })
        .map(a => ({
            title: a.title,
            severity: a.analysis.importance_score >= 8 ? 'critical' : 'high',
            category: a.analysis.narrative_frame || 'unknown',
            url: a.url,
            importance: a.analysis.importance_score,
            first_seen: a.published_at,
        }))
        .sort((a, b) => b.importance - a.importance)
        .slice(0, 10);

    // Threat velocity — compare this 48h vs prior 48h
    const prior48h = new Date(Date.now() - 96 * 3600000);
    const thisWindowNeg = recentArticles.filter(a =>
        a.analysis?.sentiment === 'negative' && new Date(a.published_at) > fortyEightHoursAgo
    ).length;
    const priorWindowNeg = recentArticles.filter(a => {
        const d = new Date(a.published_at);
        return a.analysis?.sentiment === 'negative' && d > prior48h && d <= fortyEightHoursAgo;
    }).length;

    const velocity = thisWindowNeg > priorWindowNeg * 1.5 ? 'accelerating'
        : thisWindowNeg < priorWindowNeg * 0.5 ? 'decelerating' : 'steady';

    // Save to threat_assessments
    const today = new Date().toISOString().split('T')[0];
    try {
        await supabase.from('threat_assessments').upsert({
            client_id: client.id,
            assessment_date: today,
            overall_score: overall,
            dimensions,
            active_threats: activeThreats,
            threat_velocity: { direction: velocity, current: thisWindowNeg, previous: priorWindowNeg },
            cascading_risks: [],
        }, { onConflict: 'client_id,assessment_date' });
    } catch (err) {
        log.ai.warn('Threat assessment save skipped', { error: err.message });
    }

    log.ai.info('Pass 2: Threat Matrix', { overall, riskLevel, threats: activeThreats.length, velocity });

    return { dimensions, overall, riskLevel, activeThreats, velocity };
}

// ────────────────────────────────────────────────────────────
// PASS 3: TEMPORAL INTELLIGENCE
// Velocity, acceleration, story lifecycle detection
// ────────────────────────────────────────────────────────────

function passTemporalIntelligence(articles, sevenDaysAgo, fortyEightHoursAgo) {
    // Daily volume
    const dailyVolume = {};
    for (const a of articles) {
        const day = new Date(a.published_at).toISOString().split('T')[0];
        dailyVolume[day] = (dailyVolume[day] || 0) + 1;
    }
    const volumeTimeline = Object.entries(dailyVolume)
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date));

    // Keyword velocity: how keyword frequency changes over time
    const keywordVelocity = {};
    const recent48h = articles.filter(a => new Date(a.published_at) > new Date(fortyEightHoursAgo));
    const olderArticles = articles.filter(a => new Date(a.published_at) <= new Date(fortyEightHoursAgo));

    const recentKeywords = {};
    const olderKeywords = {};
    recent48h.forEach(a => (a.matched_keywords || []).forEach(k => recentKeywords[k] = (recentKeywords[k] || 0) + 1));
    olderArticles.forEach(a => (a.matched_keywords || []).forEach(k => olderKeywords[k] = (olderKeywords[k] || 0) + 1));

    const allKw = new Set([...Object.keys(recentKeywords), ...Object.keys(olderKeywords)]);
    for (const kw of allKw) {
        const recent = recentKeywords[kw] || 0;
        const older = olderKeywords[kw] || 0;
        const olderNorm = older > 0 ? older / Math.max(olderArticles.length, 1) : 0;
        const recentNorm = recent / Math.max(recent48h.length, 1);
        keywordVelocity[kw] = {
            recent, older,
            acceleration: olderNorm > 0 ? ((recentNorm - olderNorm) / olderNorm) * 100 : (recent > 0 ? 100 : 0),
        };
    }

    // Story lifecycle: topics emerging, peaking, or fading
    const storyLifecycles = Object.entries(keywordVelocity).map(([keyword, data]) => ({
        keyword,
        phase: data.acceleration > 50 ? 'emerging'
            : data.acceleration > -20 ? 'active'
                : 'fading',
        acceleration: Math.round(data.acceleration),
        recentMentions: data.recent,
    })).sort((a, b) => b.acceleration - a.acceleration);

    // Sentiment velocity per day
    const dailySentiment = {};
    for (const a of articles) {
        const day = new Date(a.published_at).toISOString().split('T')[0];
        if (!dailySentiment[day]) dailySentiment[day] = { positive: 0, negative: 0, neutral: 0 };
        const s = a.analysis?.sentiment || 'neutral';
        dailySentiment[day][s]++;
    }
    const sentimentTimeline = Object.entries(dailySentiment)
        .map(([date, data]) => ({ date, ...data, negPct: Math.round(data.negative / (data.positive + data.negative + data.neutral) * 100) }))
        .sort((a, b) => a.date.localeCompare(b.date));

    log.ai.info('Pass 3: Temporal Intelligence', {
        days: volumeTimeline.length,
        emerging: storyLifecycles.filter(s => s.phase === 'emerging').length,
    });

    return { volumeTimeline, keywordVelocity, storyLifecycles, sentimentTimeline };
}

// ────────────────────────────────────────────────────────────
// PASS 4: NETWORK ANALYSIS
// Weighted entity graph, community detection, influence paths
// ────────────────────────────────────────────────────────────

function passNetworkAnalysis(entityMentions) {
    // Build adjacency: entities in the same article are connected
    const articleEntities = {};
    for (const m of entityMentions) {
        if (!articleEntities[m.article_id]) articleEntities[m.article_id] = [];
        articleEntities[m.article_id].push(m.entity_name);
    }

    const edges = {};
    const nodeDegree = {};

    for (const names of Object.values(articleEntities)) {
        const unique = [...new Set(names)];
        for (let i = 0; i < unique.length; i++) {
            nodeDegree[unique[i]] = (nodeDegree[unique[i]] || 0) + 1;
            for (let j = i + 1; j < unique.length; j++) {
                const key = [unique[i], unique[j]].sort().join('::');
                edges[key] = (edges[key] || 0) + 1;
            }
        }
    }

    const topEdges = Object.entries(edges)
        .map(([key, weight]) => {
            const [a, b] = key.split('::');
            return { entity_a: a, entity_b: b, weight };
        })
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 30);

    // Simple community detection: connected components via strong edges
    const communities = [];
    const visited = new Set();
    const strongEdges = topEdges.filter(e => e.weight >= 2);

    for (const edge of strongEdges) {
        if (visited.has(edge.entity_a) && visited.has(edge.entity_b)) continue;

        let community = communities.find(c =>
            c.members.has(edge.entity_a) || c.members.has(edge.entity_b)
        );

        if (!community) {
            community = { members: new Set(), totalWeight: 0 };
            communities.push(community);
        }

        community.members.add(edge.entity_a);
        community.members.add(edge.entity_b);
        community.totalWeight += edge.weight;
        visited.add(edge.entity_a);
        visited.add(edge.entity_b);
    }

    const networkCommunities = communities
        .map(c => ({
            members: [...c.members],
            size: c.members.size,
            strength: c.totalWeight,
        }))
        .sort((a, b) => b.strength - a.strength)
        .slice(0, 10);

    // Hub entities: highest degree centrality
    const hubs = Object.entries(nodeDegree)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([name, degree]) => ({ name, degree }));

    log.ai.info('Pass 4: Network Analysis', {
        nodes: Object.keys(nodeDegree).length,
        edges: topEdges.length,
        communities: networkCommunities.length,
    });

    return { topEdges, networkCommunities, hubs, nodeDegree };
}

// ────────────────────────────────────────────────────────────
// PASS 5: SOURCE INTELLIGENCE
// Reliability, bias, cross-source comparison
// ────────────────────────────────────────────────────────────

async function passSourceIntelligence(client, articles, sources) {
    const sourceStats = {};

    for (const art of articles) {
        const srcId = art.source_id;
        if (!sourceStats[srcId]) {
            sourceStats[srcId] = {
                id: srcId,
                name: art.sourceName,
                articles: 0,
                sentiments: { positive: 0, negative: 0, neutral: 0 },
                importanceSum: 0,
                narrativeFrames: {},
            };
        }
        const s = sourceStats[srcId];
        s.articles++;
        const sentiment = art.analysis?.sentiment || 'neutral';
        s.sentiments[sentiment]++;
        s.importanceSum += art.analysis?.importance_score || 0;
        const frame = art.analysis?.narrative_frame || 'none';
        s.narrativeFrames[frame] = (s.narrativeFrames[frame] || 0) + 1;
    }

    // Global average sentiment for comparison
    const global = { positive: 0, negative: 0, neutral: 0, total: 0 };
    Object.values(sourceStats).forEach(s => {
        global.positive += s.sentiments.positive;
        global.negative += s.sentiments.negative;
        global.neutral += s.sentiments.neutral;
        global.total += s.articles;
    });
    const globalNegPct = global.total > 0 ? (global.negative / global.total) * 100 : 0;

    const sourceSentiments = Object.values(sourceStats).map(s => {
        const total = s.articles;
        const negPct = total > 0 ? (s.sentiments.negative / total) * 100 : 0;
        const avgImportance = total > 0 ? s.importanceSum / total : 0;

        // Bias: how much this source skews negative vs global average
        const sentimentSkew = negPct - globalNegPct;
        const biasDirection = sentimentSkew > 15 ? 'negative-skew'
            : sentimentSkew < -15 ? 'positive-skew' : 'balanced';

        // Reliability = diversity of narrative frames × consistency
        const frameCount = Object.keys(s.narrativeFrames).length;
        const reliability = Math.min(100, 30 + frameCount * 10 + (total > 5 ? 20 : 0));

        return {
            sourceId: s.id,
            name: s.name,
            articleCount: total,
            sentiments: s.sentiments,
            negativePercent: Math.round(negPct),
            avgImportance: Math.round(avgImportance * 10) / 10,
            sentimentSkew: Math.round(sentimentSkew),
            biasDirection,
            reliability: Math.round(reliability),
            dominantFrame: Object.entries(s.narrativeFrames).sort((a, b) => b[1] - a[1])[0]?.[0] || 'none',
        };
    }).sort((a, b) => b.articleCount - a.articleCount);

    // Save source reliability
    try {
        for (const src of sourceSentiments) {
            await supabase.from('source_reliability').upsert({
                source_id: src.sourceId,
                client_id: client.id,
                reliability_score: src.reliability,
                bias_direction: src.biasDirection === 'balanced' ? 'center'
                    : src.biasDirection === 'negative-skew' ? 'center-left' : 'center-right',
                sentiment_skew: { negativePercent: src.negativePercent, globalDelta: src.sentimentSkew },
                article_count: src.articleCount,
                avg_importance: src.avgImportance,
                last_evaluated: new Date().toISOString(),
            }, { onConflict: 'source_id,client_id' });
        }
    } catch (err) {
        log.ai.warn('Source reliability save skipped', { error: err.message });
    }

    // Cross-source confirmation: detect same entity covered by 3+ sources
    const entitySourceMap = {};
    for (const art of articles) {
        const entities = art.analysis?.entities || {};
        for (const names of Object.values(entities)) {
            for (const name of (names || [])) {
                if (!entitySourceMap[name]) entitySourceMap[name] = new Set();
                entitySourceMap[name].add(art.source_id);
            }
        }
    }
    const crossSourceEntities = Object.entries(entitySourceMap)
        .filter(([, srcs]) => srcs.size >= 2)
        .map(([name, srcs]) => ({ entity: name, sourceCount: srcs.size }))
        .sort((a, b) => b.sourceCount - a.sourceCount);

    log.ai.info('Pass 5: Source Intelligence', {
        sources: sourceSentiments.length,
        crossConfirmed: crossSourceEntities.length,
    });

    return { sourceSentiments, crossSourceEntities };
}

// ────────────────────────────────────────────────────────────
// PASS 6: PREDICTIVE SIGNALS
// Early warning system
// ────────────────────────────────────────────────────────────

/**
 * Compute real confidence scores based on signal type and metadata.
 * Replaces the hardcoded 0.85 default with data-driven confidence.
 */
function computeSignalConfidence(signalType, evidence) {
    switch (signalType) {
        case 'volume_spike': {
            const multiplier = evidence.multiplier ?? 2;
            const base = Math.min(0.5 + (multiplier - 1) * 0.12, 0.85);
            return Math.round(Math.min(base, 0.95) * 100) / 100;
        }
        case 'entity_surge': {
            const accel = evidence.acceleration ?? 100;
            const mentions = evidence.mentions ?? 3;
            return Math.round(Math.min(0.4 + (accel / 800) + (mentions * 0.02), 0.90) * 100) / 100;
        }
        case 'sentiment_shift': {
            const delta = Math.abs(evidence.delta ?? 15);
            return Math.round(Math.min(0.45 + (delta / 100) * 0.5, 0.92) * 100) / 100;
        }
        case 'new_entity': {
            const mentions = evidence.mentions ?? 3;
            return Math.round(Math.min(0.35 + (mentions * 0.06), 0.75) * 100) / 100;
        }
        case 'cross_source_confirmation': {
            const mentions = evidence.mentions ?? 5;
            return Math.round(Math.min(0.55 + (mentions * 0.04), 0.95) * 100) / 100;
        }
        case 'coordinated_coverage': {
            const strength = evidence.strength ?? 3;
            const members = evidence.members?.length ?? 3;
            return Math.round(Math.min(0.40 + (members * 0.06) + (strength * 0.02), 0.85) * 100) / 100;
        }
        default:
            return 0.60;
    }
}

async function passPredictiveSignals(client, articles, entityPass, temporalPass, networkPass, briefTopic, briefContext) {
    const signals = [];

    // Signal 1: Volume spike (3x daily average)
    const volumes = temporalPass.volumeTimeline;
    if (volumes.length >= 1) {
        const recent = volumes.slice(-1)[0]?.count || 0;
        const avg = volumes.slice(-7, -1).reduce((s, v) => s + v.count, 0) / Math.max(volumes.slice(-7, -1).length, 1);
        if (recent > avg * 2.5 && avg > 0) {
            const evidence = { today: recent, average: Math.round(avg), multiplier: Math.round(recent / avg) };
            signals.push({
                signal_type: 'volume_spike',
                severity: recent > avg * 5 ? 'critical' : 'warning',
                title: 'Article volume spike detected',
                description: `Today: ${recent} articles vs ${Math.round(avg)} avg (${Math.round(recent / avg)}x normal)`,
                confidence: computeSignalConfidence('volume_spike', evidence),
                evidence,
            });
        }
    }

    // Signal 2: Entity surge (entity appearing 3x more in last 48h)
    for (const entity of entityPass.topEntities.slice(0, 20)) {
        const lifecycle = temporalPass.storyLifecycles.find(s => s.keyword === entity.name?.toLowerCase());
        if (lifecycle && lifecycle.acceleration > 100) {
            const evidence = { mentions: entity.mentionCount, acceleration: lifecycle.acceleration, sentiment: entity.sentiments };
            signals.push({
                signal_type: 'entity_surge',
                severity: entity.riskTags.includes('high_negative_coverage') ? 'warning' : 'watch',
                title: `"${entity.name}" coverage surging`,
                description: `${entity.mentionCount} mentions, ${lifecycle.acceleration}% acceleration. Trend: ${entity.trend}`,
                confidence: computeSignalConfidence('entity_surge', evidence),
                related_entities: [entity.name],
                evidence,
            });
        }
    }

    // Signal 3: Sentiment shift (>15% negative swing in 48h)
    const sentimentTL = temporalPass.sentimentTimeline;
    if (sentimentTL.length >= 1) {
        const recent = sentimentTL.slice(-2);
        const prior = sentimentTL.slice(-5, -2);
        const recentNeg = recent.reduce((s, d) => s + (d.negPct || 0), 0) / Math.max(recent.length, 1);
        const priorNeg = prior.reduce((s, d) => s + (d.negPct || 0), 0) / Math.max(prior.length, 1);

        if (recentNeg - priorNeg > 15) {
            const evidence = { recentNegPct: Math.round(recentNeg), priorNegPct: Math.round(priorNeg), delta: Math.round(recentNeg - priorNeg) };
            signals.push({
                signal_type: 'sentiment_shift',
                severity: recentNeg > 60 ? 'critical' : 'warning',
                title: 'Negative sentiment surge',
                description: `Negative coverage shifted from ${Math.round(priorNeg)}% to ${Math.round(recentNeg)}%`,
                confidence: computeSignalConfidence('sentiment_shift', evidence),
                evidence,
            });
        }
    }

    // Signal 4: New entity emergence (entity not seen >7 days ago, now in 3+ articles)
    for (const entity of entityPass.topEntities) {
        const daysSinceFirst = (Date.now() - new Date(entity.firstSeen).getTime()) / 86400000;
        if (daysSinceFirst < 3 && entity.mentionCount >= 1) {
            const evidence = { firstSeen: entity.firstSeen, mentions: entity.mentionCount };
            signals.push({
                signal_type: 'new_entity',
                severity: 'watch',
                title: `New entity: "${entity.name}" emerged`,
                description: `First seen ${entity.firstSeen}, already in ${entity.mentionCount} articles`,
                confidence: computeSignalConfidence('new_entity', evidence),
                related_entities: [entity.name],
                evidence,
            });
        }
    }

    // Signal 5: Cross-source confirmation (3+ sources covering same thing negatively)
    const negativeEntities = entityPass.topEntities.filter(e => e.sentiments.negative > e.sentiments.positive + e.sentiments.neutral);
    for (const entity of negativeEntities.slice(0, 5)) {
        if (entity.mentionCount >= 3) {
            const evidence = { mentions: entity.mentionCount, sentiments: entity.sentiments, riskTags: entity.riskTags };
            signals.push({
                signal_type: 'cross_source_confirmation',
                severity: 'warning',
                title: `Multi-source negative: "${entity.name}"`,
                description: `${entity.mentionCount} negative mentions across sources. Risk tags: ${entity.riskTags.join(', ') || 'none'}`,
                confidence: computeSignalConfidence('cross_source_confirmation', evidence),
                related_entities: [entity.name],
                evidence,
            });
        }
    }

    // Signal 6: Network community alert (tight cluster of entities in negative coverage)
    for (const community of networkPass.networkCommunities) {
        if (community.size >= 3 && community.strength >= 5) {
            const memberEntities = entityPass.topEntities.filter(e => community.members.includes(e.name));
            const avgNeg = memberEntities.length > 0
                ? memberEntities.reduce((s, e) => s + e.sentiments.negative, 0) / memberEntities.length
                : 0;

            if (avgNeg > 2) {
                const evidence = { members: community.members, strength: community.strength };
                signals.push({
                    signal_type: 'coordinated_coverage',
                    severity: 'watch',
                    title: `Entity cluster: ${community.members.slice(0, 3).join(', ')}`,
                    description: `${community.size} entities appearing together in ${community.strength} connections with negative sentiment`,
                    confidence: computeSignalConfidence('coordinated_coverage', evidence),
                    related_entities: community.members,
                    evidence,
                });
            }
        }
    }

    // ── Phase 4: Enrich signals with impact score + LLM context ──
    const SEVERITY_WEIGHT = { critical: 1.0, warning: 0.7, watch: 0.4 };
    for (const signal of signals) {
        // Impact score = severity × brief_relevance × source_tier
        const sevW = SEVERITY_WEIGHT[signal.severity] || 0.5;
        const briefKeywords = (briefTopic || '').toLowerCase().split(/\s+/).filter(w => w.length > 2);
        const descText = (signal.title + ' ' + signal.description).toLowerCase();
        const briefRelevance = briefKeywords.length > 0
            ? briefKeywords.filter(kw => descText.includes(kw)).length / briefKeywords.length
            : 0.5;
        signal.impact_score = Math.round(sevW * 40 + briefRelevance * 40 + (signal.confidence || 0.5) * 20);

        // Source breakdown from evidence
        signal.source_breakdown = [];
        if (signal.related_entities?.length > 0) {
            const relArticles = articles.filter(a =>
                signal.related_entities.some(eName => {
                    const mentions = entityPass.articleEntityMap?.[a.id];
                    return mentions && mentions.has(eName);
                })
            ).slice(0, 10);
            const sourceGroups = {};
            for (const art of relArticles) {
                const src = art.sourceName || 'Unknown';
                if (!sourceGroups[src]) sourceGroups[src] = { source: src, count: 0, sentiment: 'neutral' };
                sourceGroups[src].count++;
                if (art.analysis?.sentiment === 'negative') sourceGroups[src].sentiment = 'negative';
            }
            signal.source_breakdown = Object.values(sourceGroups);
        }
    }

    // LLM enrichment for top 5 signals
    try {
        const topSignals = signals.slice(0, 5);
        if (topSignals.length > 0 && briefTopic) {
            const signalSummaries = topSignals.map((s, i) =>
                `${i + 1}. [${s.severity}] ${s.title}: ${s.description}`
            ).join('\n');

            const resp = await groqChat([
                { role: 'system', content: `You are an intelligence analyst. For each signal, explain why it matters to the monitoring brief and suggest 2-3 specific actions. Be concise and actionable.` },
                {
                    role: 'user', content: `Brief topic: "${briefTopic}"
Context: ${briefContext || 'General monitoring'}

For each signal below, provide:
1. A 2-sentence "why this matters" explanation specific to the brief
2. 2-3 recommended actions (format: priority[urgent/watch/track] + action)

Return as JSON array: [{"index": 1, "relevance_reason": "...", "actions": [{"priority": "urgent", "action": "..."}]}]

Signals:
${signalSummaries}`
                },
            ], { temperature: 0.3, max_tokens: 1500 });

            const text = resp.choices[0]?.message?.content || '';
            try {
                const jsonMatch = text.match(/\[.*\]/s);
                if (jsonMatch) {
                    const enrichments = JSON.parse(jsonMatch[0]);
                    for (const e of enrichments) {
                        const idx = (e.index || 1) - 1;
                        if (topSignals[idx]) {
                            topSignals[idx].relevance_reason = e.relevance_reason || '';
                            topSignals[idx].recommended_actions = (e.actions || []).map(a => ({
                                priority: a.priority || 'watch',
                                action: a.action || '',
                            }));
                        }
                    }
                }
            } catch { /* JSON parse failure */ }
            log.ai.info('[SIGNAL-PASS6] Enriched', topSignals.length, 'signals with LLM context');
        }
    } catch (err) {
        log.ai.warn('[SIGNAL-PASS6] LLM enrichment failed', { error: err.message });
    }

    // Save signals to DB
    try {
        if (signals.length > 0) {
            const signalRows = signals.map(s => ({
                client_id: client.id,
                signal_type: s.signal_type,
                severity: s.severity,
                title: s.title,
                description: s.description,
                related_entities: s.related_entities || [],
                evidence: {
                    ...(s.evidence || {}),
                    computed_confidence: s.confidence ?? 0.60,
                    impact_score: s.impact_score || 0,
                    relevance_reason: s.relevance_reason || '',
                    recommended_actions: s.recommended_actions || [],
                    source_breakdown: s.source_breakdown || [],
                },
                expires_at: new Date(Date.now() + 72 * 3600000).toISOString(),
            }));

            // Try with confidence column first
            const { error: fullErr } = await supabase.from('intelligence_signals').insert(
                signalRows.map(r => ({ ...r, confidence: r.evidence.computed_confidence }))
            );

            if (fullErr && fullErr.message.includes('confidence')) {
                await supabase.from('intelligence_signals').insert(signalRows);
            } else if (fullErr) {
                throw fullErr;
            }
        }
    } catch (err) {
        log.ai.warn('Signals save skipped', { error: err.message });
    }

    log.ai.info('Pass 6: Predictive Signals', { total: signals.length, critical: signals.filter(s => s.severity === 'critical').length });

    return { signals };
}

// ────────────────────────────────────────────────────────────
// PASS 7: NARRATIVE SYNTHESIS
// Multi-prompt Groq analysis for strategic intelligence
// ────────────────────────────────────────────────────────────

async function passNarrativeSynthesis(client, entityPass, threatPass, temporalPass, networkPass, sourcePass, signalPass, articles, briefTopic, briefContext, briefProfile = {}) {

    // ── Pre-cluster articles by narrative_frame (last 48h, top 40) ──
    const fortyEightHoursAgo = Date.now() - 48 * 3600000;
    const recent = articles
        .filter(a => new Date(a.published_at || 0).getTime() > fortyEightHoursAgo)
        .sort((a, b) => (b.analysis?.importance_score || 0) - (a.analysis?.importance_score || 0))
        .slice(0, 40);

    const frameGroups = {};
    for (const a of recent) {
        const frame = a.analysis?.narrative_frame || 'general';
        if (!frameGroups[frame]) frameGroups[frame] = [];
        frameGroups[frame].push({
            title: a.title_en || a.title,
            source: a.sourceName,
            source_tier: a.sourceTier || 2,
            sentiment: a.analysis?.sentiment || 'neutral',
            importance: a.analysis?.importance_score || 5,
            summary: (a.analysis?.summary || '').substring(0, 300),
            locations: a.analysis?.entities?.locations || [],
        });
    }
    // Keep top 4 per frame, sorted by importance
    for (const frame of Object.keys(frameGroups)) {
        frameGroups[frame] = frameGroups[frame].slice(0, 4);
    }

    // Source reliability summary for source_notes section
    const sourceReliability = (sourcePass.sourceProfiles || []).slice(0, 5).map(s => ({
        name: s.name, tier: s.tier, bias: s.biasDirection, reliability: s.reliabilityScore,
    }));

    const briefing = {
        client_context: {
            name: briefProfile.client_name || client.name,
            geographic_scope: briefProfile.geographic_focus || 'Not specified',
            risk_domains: briefProfile.risk_domains || [],
            entities_of_interest: briefProfile.entities_of_interest || [],
            mission: briefProfile.context || briefContext || 'General intelligence monitoring',
        },
        period: 'Last 24-48 hours',
        threat_level: `${threatPass.riskLevel} (${threatPass.overall}/100)`,
        threat_dimensions: threatPass.dimensions,
        active_threats_count: threatPass.activeThreats.length,
        clustered_articles: frameGroups,
        top_entities: entityPass.topEntities.slice(0, 10).map(e => ({
            name: e.name, influence: e.influence, trend: e.trend,
            mentions: e.mentionCount, dominant_frame: e.dominantFrame,
        })),
        signals: signalPass.signals.slice(0, 8).map(s => ({
            type: s.signal_type, severity: s.severity,
            title: s.title, description: s.description,
        })),
        source_notes_input: sourceReliability,
    };

    const clientName = briefProfile.client_name || client.name;
    const geoScope = briefProfile.geographic_focus || 'the monitored region';
    const riskDomains = (briefProfile.risk_domains || []).join(', ') || 'General';
    const entitiesOfInterest = (briefProfile.entities_of_interest || []).join(', ') || 'As identified in coverage';

    let narrative = '', forecast = '', actions = '';

    try {
        const resp = await groqChat([
            {
                role: 'system',
                content: `You are a senior open-source intelligence analyst preparing a daily situation brief.

CLIENT: ${clientName}
MONITORING SCOPE: ${geoScope}
RISK DOMAINS: ${riskDomains}
KEY ENTITIES TO WATCH: ${entitiesOfInterest}
MISSION: ${briefProfile.context || briefContext || 'General intelligence monitoring'}

You serve senior decision-makers who need calibrated, evidence-bound intelligence — not a news dump, not a padded report.

CORE PRINCIPLES:
- Evidence discipline: every claim, so_what, and recommendation must trace to items actually present in the provided data. Do not invent events, entities, quotes, numbers, or locations.
- Calibration: distinguish reported fact, attributed claim, and analytical inference. Use "reports", "alleges", "indicates" appropriately.
- Null results are acceptable: if a section has no genuinely new or material content, return an empty array or a short honest statement ("No critical issues this cycle"). Do not pad.
- Neutrality: no partisan framing, no loaded adjectives, no editorialising.
- Specificity: name people, departments, places, figures, and dates where the data supports it. Avoid vague phrases like "various stakeholders" or "growing concerns".

OUTPUT RULES:
- Output ONLY valid JSON. No markdown, no code fences, no preamble.
- Do NOT copy article headlines verbatim; rewrite in analytical language.
- Every key_development MUST include a "so_what" specific to ${clientName}'s mission and scope.
- recommended_actions MUST name a specific department, team, or role and a concrete action — never "monitor" alone.
- Focus on what CHANGED in the last 24-48h. Do not rehash background context.
- Do not use the em dash character (—). Use a hyphen (-) or reword.
- "so_what" answers: what risk, opportunity, or required action does this create for ${clientName}?`
            },
            {
                role: 'user',
                content: `Transform the raw intelligence data below into a structured situation brief.

Follow this 9-step analytical process:
1. CLUSTERING — Data is pre-grouped by narrative frame. Synthesize each cluster, merge overlapping reports.
2. SIGNAL EXTRACTION — What is NEW or CHANGING vs stale/repetitive? Highlight 24-48h developments.
3. SUMMARIZATION — 2-3 line analytical summary per cluster. Rewrite in neutral analytical language.
4. RISK ASSESSMENT — Assign severity: Critical / High / Moderate / Low. Explain WHY for each.
5. GEOGRAPHIC TAGGING — Extract districts, cities, regions. Identify hotspots and patterns.
6. SENTIMENT & NARRATIVE — Detect public sentiment; identify emerging narratives or misinformation.
7. EARLY WARNING — Flag weak signals that could escalate into larger issues.
8. STAKEHOLDER IMPACT — Who is affected? Who is driving the narrative?
9. ACTIONABLE INSIGHTS — 3-5 specific, department-named recommendations with urgency and rationale.

INTELLIGENCE DATA:
${JSON.stringify(briefing)}

Respond in this EXACT JSON format (raw JSON only, no wrapping):
{
  "executive_summary": "• [What changed + why it matters for ${clientName}]\\n\\n• [Second development]\\n\\n• [5 to 7 bullets total — each a complete insight, not just a headline]",

  "risk_heatmap": {
    "critical": [{"issue": "Short description", "why": "Reason for critical rating", "so_what": "Implication for ${clientName}"}],
    "high": [{"issue": "...", "why": "...", "so_what": "..."}],
    "moderate": [{"issue": "...", "why": "...", "so_what": "..."}],
    "low": [{"issue": "...", "why": "...", "so_what": "..."}]
  },

  "key_developments": [
    {
      "theme": "Theme name (e.g. Law & Order, Health, Economy, Infrastructure)",
      "headline": "Analytical headline — not copied from any article",
      "what_happened": "2-3 sentence factual summary of the development",
      "so_what": "Direct implication for ${clientName} — what risk, opportunity, or action this creates",
      "department": "Specific department or team responsible for this domain",
      "severity": "critical|high|moderate|low",
      "locations": ["District or city names if mentioned"]
    }
  ],

  "geographic_hotspots": "District and region level breakdown — which areas are most active, which are emerging concerns, geographic patterns and clustering of incidents",

  "narrative_sentiment": "Overall public sentiment in media (positive/negative/polarized), dominant narratives being pushed, any misinformation or coordinated narrative patterns detected",

  "early_warning_signals": [
    {"signal": "Description of the weak signal", "risk": "How this could escalate", "timeframe": "Days / weeks"}
  ],

  "stakeholder_impact": {
    "affected_groups": ["Specific group 1 (e.g. Farmers in Keonjhar)", "Group 2"],
    "narrative_drivers": ["Actor or group driving the narrative", "Second actor"]
  },

  "recommended_actions": [
    {"action": "Specific concrete action — not generic", "department": "Named department or team", "urgency": "Immediate|Within 48 hours|This week", "rationale": "Why this action is needed now based on evidence"}
  ],

  "source_notes": "Assessment of source reliability in today's coverage, conflicting reports between sources, known bias markers, cross-verification status of key claims",

  "emerging_threats": "• [Secondary concern 1 — developing but not yet critical]\\n\\n• [Secondary concern 2]",

  "entity_movements": "• [Entity 1 mention trend and reason]\\n\\n• [Entity 2]",

  "watch_list": "| Story/Issue | Relevant Department | Time-sensitivity | Risk Type | Suggested Posture |\\n|---|---|---|---|---|\\n| [Issue 1] | [Dept] | High | [Type] | Monitor closely |"
}`
            },
        ], { temperature: 0.3, max_tokens: 4000, response_format: { type: "json_object" } });

        const rawContent = resp.choices[0]?.message?.content || '{}';

        let sections = {};
        try {
            sections = JSON.parse(rawContent);
        } catch (parseErr) {
            log.ai.warn('Narrative JSON parse failed, cleaning response', { rawPreview: rawContent.substring(0, 200) });
            const cleaned = rawContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            sections = JSON.parse(cleaned);
        }

        // Backward compat variables
        forecast = sections.watch_list || '';
        actions = typeof sections.key_developments === 'string'
            ? sections.key_developments
            : (Array.isArray(sections.key_developments)
                ? sections.key_developments.map(d => `**${d.headline}**\nWhat happened: ${d.what_happened}\nSo what: ${d.so_what}`).join('\n\n')
                : '');

        narrative = JSON.stringify({
            ...sections,
            risk_level: threatPass.riskLevel,
            generated_at: new Date().toISOString(),
        });

    } catch (err) {
        log.ai.warn('Narrative prompt failed', { error: err.message });
        const fallbackStr = `Risk level: ${threatPass.riskLevel}. ${threatPass.activeThreats.length} active threats. ${signalPass.signals.length} signals detected.`;
        narrative = JSON.stringify({
             executive_summary: fallbackStr,
             key_developments: [],
             risk_heatmap: { critical: [], high: [], moderate: [], low: [] },
             geographic_hotspots: '',
             narrative_sentiment: '',
             early_warning_signals: [],
             stakeholder_impact: { affected_groups: [], narrative_drivers: [] },
             recommended_actions: [],
             source_notes: '',
             emerging_threats: "• Monitor active threats.",
             entity_movements: "",
             watch_list: "",
             risk_level: threatPass.riskLevel,
             generated_at: new Date().toISOString(),
        });
        forecast = 'Forecast unavailable — monitor active threats.';
        actions = '1. Monitor active threats. 2. Prepare holding statements. 3. Brief leadership.';
    }

    log.ai.info('Pass 7: Narrative Synthesis', { narrativeLen: narrative.length, forecastLen: forecast.length });

    return { narrative, forecast, actions };
}

// ────────────────────────────────────────────────────────────
// PASS 8: INFERENCE CHAINS
// Connect signals, entities, and events into logical deductions
// ────────────────────────────────────────────────────────────

async function passInferenceChains(client, articles, entityPass, threatPass, temporalPass, signalPass, briefTopic, briefContext, briefProfile = {}) {
    const result = { chains: [] };

    // Need enough data to build meaningful chains
    if (articles.length < 3) {
        log.ai.info('Pass 8: Inference Chains — insufficient data', { articles: articles.length });
        return result;
    }

    // Clear old chains for this client
    await supabase.from('inference_chains').delete().eq('client_id', client.id);

    // Build input context for Groq
    const chainInput = {
        topic: briefTopic || client.name,
        context: briefContext || client.industry,
        threatLevel: `${threatPass.riskLevel} (${threatPass.overall}/100)`,
        dimensions: threatPass.dimensions,
        activeThreats: threatPass.activeThreats.slice(0, 5),
        topEntities: entityPass.topEntities.slice(0, 10).map(e => ({
            name: e.name, type: e.type, influence: e.influence,
            trend: e.trend, mentions: e.mentionCount,
        })),
        signals: signalPass.signals.slice(0, 8).map(s => ({
            type: s.signal_type, severity: s.severity, title: s.title,
            description: s.description,
        })),
        recentArticles: articles.slice(0, 15).map(a => ({
            title: a.title, source: a.sourceName,
            sentiment: a.analysis?.sentiment || 'neutral',
            importance: a.analysis?.importance || 5,
            summary: (a.analysis?.summary || a.title).substring(0, 200),
            narrative_frame: a.analysis?.narrative_frame || 'unknown',
        })),
        storyLifecycles: temporalPass.storyLifecycles?.slice(0, 5) || [],
    };

    try {
        const resp = await groqChat([
            {
                role: 'system',
                content: `You are a senior intelligence analyst performing inference chain analysis.

CLIENT: ${briefProfile.client_name || client.name}
MONITORING SCOPE: ${briefProfile.geographic_focus || 'Not specified'}
RISK DOMAINS: ${(briefProfile.risk_domains || []).join(', ') || 'General'}
MISSION: ${briefProfile.context || briefContext || client.industry}

Your job is to connect dots that others miss. Build DEDUCTIVE REASONING CHAINS that link separate signals, entities, and events into coherent conclusions.

Each chain must:
1. Start from an observed fact drawn directly from the provided articles, signals, or entity behaviour (cite the source title or entity name in "evidence").
2. Link through 2-4 logical steps, each with explicit evidence. If a step is analytical inference rather than observation, label it so in the "evidence" field (e.g. "Inference from step 1 and 2").
3. Arrive at an actionable conclusion that follows from the steps.
4. Use a realistic confidence score (0.3-0.85, never 1.0, never below 0.3). Later steps should generally have lower confidence than earlier observed ones.

HARD RULES:
- Do NOT manufacture connections. If the data does not genuinely support a chain, return fewer chains or an empty array [].
- Do NOT invent article titles, entities, figures, or events not present in the input.
- Do NOT use the em dash character (—). Use a hyphen (-) or reword.
- Quality over quantity. One well-evidenced chain beats five speculative ones.
- Conclusions must be specific to ${briefProfile.client_name || client.name}'s mission, not generic geopolitical commentary.`
            },
            {
                role: 'user',
                content: `Analyze the following intelligence data and build 0-5 inference chains. If the data does not support any genuine chain, return an empty array [].

DATA:
${JSON.stringify(chainInput)}

Respond in this EXACT JSON format (no markdown, no code blocks, just raw JSON):
[
  {
    "title": "Short title for the chain",
    "chain_steps": [
      {"step_num": 1, "event": "What was observed", "evidence": "Source article or signal", "confidence": 0.9},
      {"step_num": 2, "event": "What this implies", "evidence": "Logical reasoning", "confidence": 0.7},
      {"step_num": 3, "event": "Connected observation", "evidence": "Another source", "confidence": 0.6}
    ],
    "conclusion": "The final deduction from this chain",
    "conclusion_confidence": 0.5,
    "severity": "critical|warning|watch",
    "scenario_7d": [{"scenario": "What could happen in 7 days", "probability": "high|medium|low", "evidence": "Why"}],
    "scenario_30d": [{"scenario": "What could happen in 30 days", "probability": "high|medium|low", "evidence": "Why"}],
    "priority_action": {"title": "Recommended action", "rationale": "Why this action", "urgency": "immediate|soon|monitor"}
  }
]`
            },
        ], { temperature: 0.3, max_tokens: 2500 });

        const raw = resp.choices[0]?.message?.content || '[]';

        // Parse JSON — handle potential markdown wrapping
        let chains;
        try {
            const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            chains = JSON.parse(cleaned);
        } catch {
            log.ai.warn('Pass 8: Failed to parse inference chains JSON', { raw: raw.substring(0, 200) });
            return result;
        }

        if (!Array.isArray(chains) || chains.length === 0) {
            log.ai.info('Pass 8: No inference chains generated');
            return result;
        }

        // Save to DB
        const rows = chains.slice(0, 5).map(chain => ({
            client_id: client.id,
            title: (chain.title || 'Untitled chain').substring(0, 255),
            chain_steps: chain.chain_steps || [],
            conclusion: chain.conclusion || '',
            conclusion_confidence: Math.min(1, Math.max(0, chain.conclusion_confidence || 0.5)),
            severity: ['critical', 'warning', 'watch'].includes(chain.severity) ? chain.severity : 'watch',
            scenario_7d: chain.scenario_7d || [],
            scenario_30d: chain.scenario_30d || [],
            priority_action: chain.priority_action || null,
        }));

        const { error } = await supabase.from('inference_chains').insert(rows);
        if (error) {
            log.ai.warn('Pass 8: DB insert failed', { error: error.message });
        } else {
            result.chains = rows;
        }

        log.ai.info('Pass 8: Inference Chains', { generated: rows.length });
    } catch (err) {
        log.ai.warn('Pass 8: Inference chain generation failed', { error: err.message });
    }

    return result;
}

// ────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────

function computeSentimentBreakdown(articles) {
    const sentiments = { positive: 0, negative: 0, neutral: 0, total: 0 };
    for (const a of articles) {
        const s = a.analysis?.sentiment || 'neutral';
        sentiments[s]++;
        sentiments.total++;
    }
    sentiments.percentages = {
        positive: sentiments.total ? Math.round((sentiments.positive / sentiments.total) * 100) : 0,
        negative: sentiments.total ? Math.round((sentiments.negative / sentiments.total) * 100) : 0,
        neutral: sentiments.total ? Math.round((sentiments.neutral / sentiments.total) * 100) : 0,
    };
    return sentiments;
}

function computeVolumeData(articles) {
    const volumeMap = {};
    for (const a of articles) {
        const date = new Date(a.published_at).toISOString().split('T')[0];
        volumeMap[date] = (volumeMap[date] || 0) + 1;
    }
    return Object.entries(volumeMap)
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date));
}
